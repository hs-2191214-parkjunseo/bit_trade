import { upbitClient } from '../market/upbit.rest.js';
import { PaperExchange } from '../exchange/paper.exchange.js';
import { VolatilityBreakoutStrategy } from '../strategies/volatility-breakout.strategy.js';
import { GoldenCrossRsiStrategy } from '../strategies/golden-cross-rsi.strategy.js';
import { SmartDcaStrategy } from '../strategies/smart-dca.strategy.js';
import { StrategyContext } from '../types/strategy.js';

export async function executeBacktest(market: string = 'KRW-BTC', days: number = 60) {
  const coinSymbol = market.replace('KRW-', '');
  const initialKrw = 1000000;

  // 60일 일봉 및 대용량 60분봉 수집
  const dailyCandles = await upbitClient.getDailyCandles(market, Math.min(days, 200));
  const minuteCandles = await upbitClient.getMinuteCandlesMulti(market, 60, 1000);

  // 1. 스마트 변동성 돌파 (일봉 60일 전수 시뮬레이션)
  const volExchange = new PaperExchange('스마트 변동성 돌파', initialKrw, coinSymbol);
  const volStrategy = new VolatilityBreakoutStrategy(0.35, 0.015, 0.015);

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
      const entryPrice = candle.trade_price;
      await volExchange.createOrder(
        { market, side: 'bid', ord_type: 'price', price: signal.amountKrw, currentPrice: entryPrice } as any,
        signal.reason
      );
    } else if (signal.action === 'SELL' && signal.volume && coinBal.balance > 0.000001) {
      await volExchange.createOrder(
        { market, side: 'ask', ord_type: 'market', volume: coinBal.balance, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    }
  }

  // 2. 극단 과매도 V자 반등 (60분봉 1000개 전수 시뮬레이션)
  const rsiExchange = new PaperExchange('극단 과매도 V자 반등', initialKrw, coinSymbol);
  const rsiStrategy = new GoldenCrossRsiStrategy(14, 0.015, 0.018);

  for (let i = 25; i < minuteCandles.length; i++) {
    const windowCandles = minuteCandles.slice(0, i + 1);
    const candle = windowCandles[windowCandles.length - 1];
    const coinBal = await rsiExchange.getBalance(coinSymbol);
    const krwBal = (await rsiExchange.getBalance('KRW')).balance;

    const ctx: StrategyContext = {
      market,
      currentPrice: candle.trade_price,
      krwBalance: krwBal,
      coinBalance: coinBal,
      candles: windowCandles,
    };

    const signal = await rsiStrategy.evaluate(ctx);
    if (signal.action === 'BUY' && signal.amountKrw) {
      await rsiExchange.createOrder(
        { market, side: 'bid', ord_type: 'price', price: signal.amountKrw, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    } else if (signal.action === 'SELL' && signal.volume) {
      await rsiExchange.createOrder(
        { market, side: 'ask', ord_type: 'market', volume: signal.volume, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    }
  }

  // 3. 볼린저 하단 반등 2단계 DCA (60분봉 1000개 전수 시뮬레이션)
  const dcaExchange = new PaperExchange('볼린저 하단 반등 DCA', initialKrw, coinSymbol);
  const dcaStrategy = new SmartDcaStrategy();

  for (let i = 25; i < minuteCandles.length; i++) {
    const windowCandles = minuteCandles.slice(0, i + 1);
    const candle = windowCandles[windowCandles.length - 1];
    const coinBal = await dcaExchange.getBalance(coinSymbol);
    const krwBal = (await dcaExchange.getBalance('KRW')).balance;

    const ctx: StrategyContext = {
      market,
      currentPrice: candle.trade_price,
      krwBalance: krwBal,
      coinBalance: coinBal,
      candles: windowCandles,
    };

    const signal = await dcaStrategy.evaluate(ctx);
    if (signal.action === 'BUY' && signal.amountKrw) {
      await dcaExchange.createOrder(
        { market, side: 'bid', ord_type: 'price', price: signal.amountKrw, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    } else if (signal.action === 'SELL' && signal.volume) {
      await dcaExchange.createOrder(
        { market, side: 'ask', ord_type: 'market', volume: signal.volume, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    }
  }

  const lastPrice = minuteCandles[minuteCandles.length - 1].trade_price;
  return [
    volExchange.getSummary(lastPrice),
    rsiExchange.getSummary(lastPrice),
    dcaExchange.getSummary(lastPrice),
  ];
}
