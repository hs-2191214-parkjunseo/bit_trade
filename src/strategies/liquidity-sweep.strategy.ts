import { IStrategy, StrategyContext, StrategySignal } from '../types/strategy.js';
import { calculateRSI } from '../indicators/rsi.js';

export class LiquiditySweepStrategy implements IStrategy {
  readonly name = '유동성 사냥 반전 (Liquidity Sweep)';
  readonly description = '직전 20봉 전저점을 꼬리로 찌르고 말아올린 스톱헌팅 반등 매수, 타이트 손절(-1.2%) & +2.2% 익절';

  private takeProfitRate: number = 0.022; // +2.2%
  private stopLossRate: number = 0.012;   // -1.2% 극단 타이트 손절

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const { currentPrice, coinBalance, krwBalance, candles } = context;

    if (candles.length < 25) {
      return { action: 'HOLD', reason: '최소 25개 이상의 캔들 데이터 필요' };
    }

    const todayCandle = candles[candles.length - 1];
    const prevWindow = candles.slice(-21, -1); // 직전 20개 봉
    const swingLow = Math.min(...prevWindow.map((c) => c.low_price));

    const closes = candles.map((c) => c.trade_price);
    const rsi = calculateRSI(closes, 14);
    const curRsi = rsi[rsi.length - 1];

    const hasCoin = coinBalance && coinBalance.balance > 0.000001;

    // 1. 보유 중일 때: 익절 및 손절
    if (hasCoin && coinBalance.avg_buy_price > 0) {
      const profitRate = (currentPrice - coinBalance.avg_buy_price) / coinBalance.avg_buy_price;

      if (profitRate >= this.takeProfitRate || curRsi >= 70) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `유동성 사냥 반등 목표 익절 (+${(profitRate * 100).toFixed(2)}%)`,
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

    // 2. 미보유 상태: 유동성 스윕(Liquidity Sweep) 탐색
    // 조건:
    // A. 캔들의 최저가가 직전 20봉 전저점(Swing Low)을 하향 돌파 (개미 스탑로스 유도)
    // B. 그러나 현재 종가는 전저점 위로 강하게 복귀
    // C. 시가 대비 종가가 상승한 양봉이거나 아래꼬리가 긴 망치형
    const dippedBelow = todayCandle.low_price < swingLow;
    const closedAbove = currentPrice >= swingLow;
    const isBullishHammer = currentPrice > todayCandle.opening_price;

    if (!hasCoin && dippedBelow && closedAbove && isBullishHammer && krwBalance >= 5000) {
      return {
        action: 'BUY',
        amountKrw: Math.floor(krwBalance * 0.98),
        reason: `직전 전저점(${Math.floor(swingLow).toLocaleString()}) 꼬리 찌른 후 유동성 흡수 양봉 반등`,
      };
    }

    return {
      action: 'HOLD',
      reason: `직전 20봉 전저점: ${Math.floor(swingLow).toLocaleString()} / 현재가: ${currentPrice.toLocaleString()}`,
    };
  }
}
