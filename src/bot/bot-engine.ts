import { upbitClient } from '../market/upbit.rest.js';
import { PaperExchange } from '../exchange/paper.exchange.js';
import { IStrategy, StrategyContext } from '../types/strategy.js';
import { VolatilityBreakoutStrategy } from '../strategies/volatility-breakout.strategy.js';
import { GoldenCrossRsiStrategy } from '../strategies/golden-cross-rsi.strategy.js';
import { SmartDcaStrategy } from '../strategies/smart-dca.strategy.js';
import { Candle, TickerData } from '../types/market.js';

export interface StrategyInstance {
  id: string;
  strategy: IStrategy;
  exchange: PaperExchange;
  lastSignalReason: string;
  lastEvaluatedAt: string;
}

export class BotEngine {
  market: string;
  coinSymbol: string;
  instances: StrategyInstance[] = [];
  isRunning: boolean = false;
  timer: NodeJS.Timeout | null = null;
  intervalMs: number = 5000; // 5초 주기 감시
  lastTicker: TickerData | null = null;
  lastCandles: Candle[] = [];
  dailyCandles: Candle[] = [];

  constructor(market: string = 'KRW-BTC', initialSeedPerStrategy: number = 1000000) {
    this.market = market;
    this.coinSymbol = market.replace('KRW-', '');

    // 3가지 전략 인스턴스 초기화
    this.instances = [
      {
        id: 'strat_volatility',
        strategy: new VolatilityBreakoutStrategy(0.5, 0.03),
        exchange: new PaperExchange('변동성 돌파', initialSeedPerStrategy, this.coinSymbol),
        lastSignalReason: '대기 중',
        lastEvaluatedAt: '',
      },
      {
        id: 'strat_goldencross',
        strategy: new GoldenCrossRsiStrategy(7, 20, 14, 0.035),
        exchange: new PaperExchange('골든크로스+RSI', initialSeedPerStrategy, this.coinSymbol),
        lastSignalReason: '대기 중',
        lastEvaluatedAt: '',
      },
      {
        id: 'strat_dca',
        strategy: new SmartDcaStrategy(),
        exchange: new PaperExchange('스마트 분할매수', initialSeedPerStrategy, this.coinSymbol),
        lastSignalReason: '대기 중',
        lastEvaluatedAt: '',
      },
    ];
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[BotEngine] 봇 가동 시작: 타깃 마켓 = ${this.market}`);

    // 첫 실행
    await this.step();

    // 루프 실행
    this.timer = setInterval(async () => {
      try {
        await this.step();
      } catch (err: any) {
        console.error(`[BotEngine Error] ${err.message}`);
      }
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('[BotEngine] 봇 정지');
  }

  async step() {
    // 1. 시장 데이터 갱신
    this.lastTicker = await upbitClient.getTicker(this.market);
    // 60분봉 60개 및 일봉 30개 수신
    this.lastCandles = await upbitClient.getMinuteCandles(this.market, 60, 60);
    this.dailyCandles = await upbitClient.getDailyCandles(this.market, 30);

    const currentPrice = this.lastTicker.trade_price;

    // 2. 각 전략 순회 평가
    for (const inst of this.instances) {
      const coinBalance = await inst.exchange.getBalance(this.coinSymbol);
      const krwBalance = (await inst.exchange.getBalance('KRW')).balance;

      // 변동성 돌파는 일봉 캔들 전달, 나머지는 60분봉 전달
      const candlesToUse = inst.id === 'strat_volatility' ? this.dailyCandles : this.lastCandles;

      const context: StrategyContext = {
        market: this.market,
        currentPrice,
        krwBalance,
        coinBalance,
        candles: candlesToUse,
      };

      try {
        const signal = await inst.strategy.evaluate(context);
        inst.lastSignalReason = signal.reason;
        inst.lastEvaluatedAt = new Date().toISOString();

        if (signal.action === 'BUY' && signal.amountKrw && signal.amountKrw >= 5000) {
          console.log(`[${inst.strategy.name}] 매수 시그널 발생! 사유: ${signal.reason}`);
          await inst.exchange.createOrder(
            {
              market: this.market,
              side: 'bid',
              ord_type: 'price',
              price: signal.amountKrw,
              currentPrice,
            } as any,
            signal.reason
          );
        } else if (signal.action === 'SELL' && signal.volume && signal.volume > 0.000001) {
          console.log(`[${inst.strategy.name}] 매도 시그널 발생! 사유: ${signal.reason}`);
          await inst.exchange.createOrder(
            {
              market: this.market,
              side: 'ask',
              ord_type: 'market',
              volume: signal.volume,
              currentPrice,
            } as any,
            signal.reason
          );
        }
      } catch (e: any) {
        console.error(`[${inst.strategy.name}] 실행 오류: ${e.message}`);
      }
    }
  }

  getStatus() {
    const currentPrice = this.lastTicker ? this.lastTicker.trade_price : 0;
    return {
      market: this.market,
      currentPrice,
      ticker: this.lastTicker,
      isRunning: this.isRunning,
      updatedAt: new Date().toISOString(),
      strategies: this.instances.map((inst) => {
        const summary = inst.exchange.getSummary(currentPrice);
        return {
          id: inst.id,
          name: inst.strategy.name,
          description: inst.strategy.description,
          lastSignalReason: inst.lastSignalReason,
          lastEvaluatedAt: inst.lastEvaluatedAt,
          summary,
        };
      }),
    };
  }
}
