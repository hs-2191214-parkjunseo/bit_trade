import { IStrategy, StrategyContext, StrategySignal } from '../types/strategy.js';
import { calculateRSI } from '../indicators/rsi.js';
import { calculateBollingerBands } from '../indicators/bollinger.js';
import { checkBullishDivergence } from '../indicators/divergence.js';

export class GoldenCrossRsiStrategy implements IStrategy {
  readonly name = '극단 과매도 V자 반등 (Oversold Sniper)';
  readonly description = 'RSI 강세 다이버전스 또는 볼린저 하단 이탈 후 양봉 반등 시 매수, +1.8% 또는 중심선 익절';

  private rsiPeriod: number;
  private takeProfitRate: number;
  private stopLossRate: number;

  constructor(rsiPeriod: number = 14, takeProfitRate: number = 0.018, stopLossRate: number = 0.018) {
    this.rsiPeriod = rsiPeriod;
    this.takeProfitRate = takeProfitRate;
    this.stopLossRate = stopLossRate;
  }

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const { currentPrice, coinBalance, krwBalance, candles } = context;

    if (candles.length < 30) {
      return { action: 'HOLD', reason: '최소 30개 이상의 캔들 데이터 필요' };
    }

    const closes = candles.map((c) => c.trade_price);
    const rsi = calculateRSI(closes, this.rsiPeriod);
    const bb = calculateBollingerBands(closes, 20, 2);
    const divResult = checkBullishDivergence(candles, this.rsiPeriod);

    if (rsi.length < 2 || bb.lower.length < 2) {
      return { action: 'HOLD', reason: '지표 계산 데이터 불충분' };
    }

    const prevCandle = candles[candles.length - 2];
    const todayCandle = candles[candles.length - 1];

    const prevRsi = rsi[rsi.length - 2];
    const curRsi = rsi[rsi.length - 1];
    const prevLower = bb.lower[bb.lower.length - 2];
    const curLower = bb.lower[bb.lower.length - 1];
    const curMiddle = bb.middle[bb.middle.length - 1];

    const hasCoin = coinBalance && coinBalance.balance > 0.000001;

    // 1. 보유 중일 때: 익절 및 손절
    if (hasCoin && coinBalance.avg_buy_price > 0) {
      const profitRate = (currentPrice - coinBalance.avg_buy_price) / coinBalance.avg_buy_price;

      // 볼린저 중심선 도달 시 또는 +1.8% 달성 시 익절
      if (currentPrice >= curMiddle && profitRate >= 0.01) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `볼린저 중심선 도달 익절 (+${(profitRate * 100).toFixed(2)}%)`,
        };
      }
      if (profitRate >= this.takeProfitRate || curRsi >= 68) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `목표 익절 달성 (+${(profitRate * 100).toFixed(2)}% / RSI: ${curRsi.toFixed(1)})`,
        };
      }
      if (profitRate <= -this.stopLossRate) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `손절선 도달 (${(profitRate * 100).toFixed(2)}% <= -${(this.stopLossRate * 100).toFixed(1)}%)`,
        };
      }
    }

    // 2. 매수 시그널 탐색:
    // 조건 A: RSI 강세 다이버전스 출현
    // 조건 B: 전봉 극단 과매도(RSI <= 30 또는 볼린저 하단 확실한 이탈) 후 현재 양봉 반등
    const wasPanicOversold = prevRsi <= 30 || prevCandle.low_price <= prevLower * 0.998;
    const isBullishRebound = currentPrice > todayCandle.opening_price && curRsi > prevRsi && curRsi <= 45;

    if (!hasCoin && krwBalance >= 5000) {
      if (divResult.isBullishDivergence) {
        return {
          action: 'BUY',
          amountKrw: Math.floor(krwBalance * 0.98),
          reason: divResult.reason || 'RSI 강세 다이버전스 포착 매수',
        };
      }
      if (wasPanicOversold && isBullishRebound) {
        return {
          action: 'BUY',
          amountKrw: Math.floor(krwBalance * 0.98),
          reason: `극단 과매도 투매(RSI ${prevRsi.toFixed(1)}) 후 양봉 V자 반등`,
        };
      }
    }

    return {
      action: 'HOLD',
      reason: `RSI: ${curRsi.toFixed(1)} / 하단선: ${Math.floor(curLower).toLocaleString()} / 중심선: ${Math.floor(curMiddle).toLocaleString()}`,
    };
  }
}
