import { IStrategy, StrategyContext, StrategySignal } from '../types/strategy.js';
import { calculateRSI } from '../indicators/rsi.js';
import { calculateEMA } from '../indicators/sma.js';
import { calculateATR } from '../indicators/atr.js';

export class LiquiditySweepStrategy implements IStrategy {
  readonly name = '유동성 사냥 반전 (Liquidity Sweep)';
  readonly description = '직전 20봉 전저점 스톱헌팅 후 유동성 흡수 양봉 반등 매수, 대추세 지지 및 ATR 동적 손절';

  private takeProfitRate: number = 0.018; // +1.8% 빠른 차익 실현
  private stopLossRate: number = 0.025;   // -2.5% 노이즈 손절 방어

  constructor(lookback: number = 20, takeProfitRate: number = 0.018, stopLossRate: number = 0.025) {
    this.takeProfitRate = takeProfitRate;
    this.stopLossRate = stopLossRate;
  }

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const { currentPrice, coinBalance, krwBalance, candles } = context;

    if (candles.length < 50) {
      return { action: 'HOLD', reason: '최소 50개 이상의 캔들 데이터 필요' };
    }

    const todayCandle = candles[candles.length - 1];
    const prevWindow = candles.slice(-21, -1); // 직전 20개 봉
    const swingLow = Math.min(...prevWindow.map((c) => c.low_price));

    const closes = candles.map((c) => c.trade_price);
    const rsi = calculateRSI(closes, 14);
    const ema50 = calculateEMA(closes, 50);
    const atrs = calculateATR(candles, 14);

    const curRsi = rsi[rsi.length - 1];
    const curEma50 = ema50[ema50.length - 1];

    // ATR 기반 동적 손절/익절 배율 산출
    const curAtr = atrs.length > 0 ? atrs[atrs.length - 1] : currentPrice * 0.015;
    const atrRatio = curAtr / currentPrice;
    const dynamicSl = Math.max(0.018, Math.min(0.026, atrRatio * 1.5));
    const dynamicTp = Math.max(0.022, Math.min(0.038, atrRatio * 2.0));

    const hasCoin = coinBalance && coinBalance.balance > 0.000001;

    // 1. 보유 중일 때: 익절 및 손절
    if (hasCoin && coinBalance.avg_buy_price > 0) {
      const profitRate = (currentPrice - coinBalance.avg_buy_price) / coinBalance.avg_buy_price;

      if (profitRate >= dynamicTp || curRsi >= 68) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `유동성 사냥 반등 목표 익절 (+${(profitRate * 100).toFixed(2)}%)`,
        };
      }

      if (profitRate <= -dynamicSl) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `동적 손절선 도달 (${(profitRate * 100).toFixed(2)}% <= -${(dynamicSl * 100).toFixed(1)}%)`,
        };
      }
    }

    // 2. 미보유 상태: 유동성 스윕(Liquidity Sweep) 탐색
    // 조건:
    // A. 캔들의 최저가가 직전 20봉 전저점(Swing Low)을 하향 돌파 (스탑헌팅 유도)
    // B. 그러나 종가는 전저점 위로 복귀
    // C. 시가 대비 종가가 상승한 양봉
    // D. [필터]: RSI가 60 이하로 과열되지 않은 자리에서만 진입
    const dippedBelow = todayCandle.low_price < swingLow;
    const closedAbove = currentPrice >= swingLow;
    const isBullishHammer = currentPrice > todayCandle.opening_price;
    const isSafeEntry = curRsi <= 60;

    if (!hasCoin && dippedBelow && closedAbove && isBullishHammer && isSafeEntry && krwBalance >= 5000) {
      return {
        action: 'BUY',
        amountKrw: Math.floor(krwBalance * 0.98),
        reason: `직전 전저점(${Math.floor(swingLow).toLocaleString()}) 꼬리 찌른 후 유동성 흡수 양봉 반등 (RSI: ${curRsi.toFixed(1)})`,
      };
    }

    return {
      action: 'HOLD',
      reason: `전저점: ${Math.floor(swingLow).toLocaleString()} / 현재가: ${currentPrice.toLocaleString()} / RSI: ${curRsi.toFixed(1)}`,
    };
  }
}
