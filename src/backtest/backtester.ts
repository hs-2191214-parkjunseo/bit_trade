import { upbitClient } from '../market/upbit.rest.js';
import { PaperExchange } from '../exchange/paper.exchange.js';
import { VolatilityBreakoutStrategy } from '../strategies/volatility-breakout.strategy.js';
import { GoldenCrossRsiStrategy } from '../strategies/golden-cross-rsi.strategy.js';
import { SmartDcaStrategy } from '../strategies/smart-dca.strategy.js';
import { VolumeSpikeStrategy } from '../strategies/volume-spike.strategy.js';
import { VolatilitySqueezeStrategy } from '../strategies/volatility-squeeze.strategy.js';
import { LiquiditySweepStrategy } from '../strategies/liquidity-sweep.strategy.js';
import { StrategyContext, IStrategy } from '../types/strategy.js';
import { SUPPORTED_MARKETS } from '../config/markets.js';

export async function executeBacktest(market: string = 'KRW-BTC', days: number = 60) {
  const coinSymbol = market.replace('KRW-', '');
  const initialKrw = 1000000;

  // 60일 일봉 및 대용량 60분봉 수집
  const dailyCandles = await upbitClient.getDailyCandles(market, Math.min(days, 200));
  const minuteCandles = await upbitClient.getMinuteCandlesMulti(market, 60, 1000);

  // 1. 스마트 변동성 돌파 (일봉 60일 전수 시뮬레이션)
  const volExchange = new PaperExchange('스마트 변동성 돌파', initialKrw, coinSymbol);
  const volStrategy = new VolatilityBreakoutStrategy(0.35, 0.015, 0.018);

  for (let i = 20; i < dailyCandles.length; i++) {
    const windowCandles = dailyCandles.slice(0, i + 1);
    const candle = windowCandles[windowCandles.length - 1];
    const coinBal = await volExchange.getBalance(coinSymbol);
    const krwBal = (await volExchange.getBalance('KRW')).balance;

    const ctx: StrategyContext = {
      market,
      currentPrice: candle.trade_price,
      krwBalance: krwBal,
      coinBalance: coinBal,
      candles: windowCandles,
    };

    const signal = await volStrategy.evaluate(ctx);
    if (signal.action === 'BUY' && signal.amountKrw && krwBal >= 5000) {
      await volExchange.createOrder(
        { market, side: 'bid', ord_type: 'price', price: signal.amountKrw, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    } else if (signal.action === 'SELL' && signal.volume && coinBal.balance > 0.000001) {
      await volExchange.createOrder(
        { market, side: 'ask', ord_type: 'market', volume: coinBal.balance, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    }
  }

  // 60분봉 기반 5대 전략 공통 시뮬레이션
  const minuteStrategies: { name: string; strategy: IStrategy; exchange: PaperExchange }[] = [
    {
      name: '극단 과매도 V자 반등',
      strategy: new GoldenCrossRsiStrategy(14, 0.018, 0.018),
      exchange: new PaperExchange('극단 과매도 V자 반등', initialKrw, coinSymbol),
    },
    {
      name: '볼린저 하단 반등 DCA',
      strategy: new SmartDcaStrategy(),
      exchange: new PaperExchange('볼린저 하단 반등 DCA', initialKrw, coinSymbol),
    },
    {
      name: '세력 거래량 폭발',
      strategy: new VolumeSpikeStrategy(2.5, 0.025, 0.015),
      exchange: new PaperExchange('세력 거래량 폭발', initialKrw, coinSymbol),
    },
    {
      name: '변동성 스퀴즈 폭발',
      strategy: new VolatilitySqueezeStrategy(0.03, 0.018),
      exchange: new PaperExchange('변동성 스퀴즈 폭발', initialKrw, coinSymbol),
    },
    {
      name: '유동성 사냥 반전',
      strategy: new LiquiditySweepStrategy(20, 0.022, 0.012),
      exchange: new PaperExchange('유동성 사냥 반전', initialKrw, coinSymbol),
    },
  ];

  for (let i = 25; i < minuteCandles.length; i++) {
    const windowCandles = minuteCandles.slice(0, i + 1);
    const candle = windowCandles[windowCandles.length - 1];

    for (const item of minuteStrategies) {
      const coinBal = await item.exchange.getBalance(coinSymbol);
      const krwBal = (await item.exchange.getBalance('KRW')).balance;

      const ctx: StrategyContext = {
        market,
        currentPrice: candle.trade_price,
        krwBalance: krwBal,
        coinBalance: coinBal,
        candles: windowCandles,
      };

      const signal = await item.strategy.evaluate(ctx);
      if (signal.action === 'BUY' && signal.amountKrw && krwBal >= 5000) {
        await item.exchange.createOrder(
          { market, side: 'bid', ord_type: 'price', price: signal.amountKrw, currentPrice: candle.trade_price } as any,
          signal.reason
        );
      } else if (signal.action === 'SELL' && signal.volume && coinBal.balance > 0.000001) {
        await item.exchange.createOrder(
          { market, side: 'ask', ord_type: 'market', volume: coinBal.balance, currentPrice: candle.trade_price } as any,
          signal.reason
        );
      }
    }
  }

  const lastPrice = minuteCandles[minuteCandles.length - 1].trade_price;
  return [
    volExchange.getSummary(lastPrice),
    ...minuteStrategies.map((s) => s.exchange.getSummary(lastPrice)),
  ];
}

export interface MarketRankingResult {
  market: string;
  name: string;
  symbol: string;
  bestStrategy: string;
  bestProfitRate: number;
  bestWinRate: number;
  totalTrades: number;
  results: any[];
}

/**
 * 전 종목 일괄 랭킹 백테스트
 */
export async function executeAllMarketsBacktest(limitMarkets: number = 8): Promise<MarketRankingResult[]> {
  const targetMarkets = SUPPORTED_MARKETS.slice(0, limitMarkets);
  const rankings: MarketRankingResult[] = [];

  for (const m of targetMarkets) {
    try {
      const results = await executeBacktest(m.id, 60);
      // 가장 수익률 높은 전략 탐색
      const best = results.reduce((max, cur) => cur.totalProfitRate > max.totalProfitRate ? cur : max, results[0]);
      rankings.push({
        market: m.id,
        name: m.name,
        symbol: m.symbol,
        bestStrategy: best.strategyName,
        bestProfitRate: best.totalProfitRate,
        bestWinRate: best.winRate,
        totalTrades: best.totalTrades,
        results,
      });
      // Rate Limit 보호
      await new Promise((r) => setTimeout(r, 200));
    } catch (e: any) {
      console.error(`[Ranking Backtest] ${m.id} 실패: ${e.message}`);
    }
  }

  // 최고 수익률 순 내림차순 정렬
  return rankings.sort((a, b) => b.bestProfitRate - a.bestProfitRate);
}
