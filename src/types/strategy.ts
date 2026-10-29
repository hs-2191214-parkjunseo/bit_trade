import { Candle } from './market.js';
import { Balance } from './exchange.js';

export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

export interface StrategySignal {
  action: SignalAction;
  targetPrice?: number;
  amountKrw?: number;   // 매수할 KRW 금액 (시장가 매수용)
  volume?: number;      // 매도할 코인 수량 (시장가 매도용)
  reason: string;
}

export interface StrategyContext {
  market: string;
  currentPrice: number;
  krwBalance: number;
  coinBalance: Balance | null;
  candles: Candle[];
}

export interface IStrategy {
  readonly name: string;
  readonly description: string;
  init?(context: StrategyContext): Promise<void>;
  evaluate(context: StrategyContext): Promise<StrategySignal>;
}
