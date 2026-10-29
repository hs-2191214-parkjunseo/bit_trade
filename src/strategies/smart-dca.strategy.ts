import { IStrategy, StrategyContext, StrategySignal } from '../types/strategy.js';
import { calculateRSI } from '../indicators/rsi.js';
import { calculateBollingerBands } from '../indicators/bollinger.js';

export class SmartDcaStrategy implements IStrategy {
  readonly name = '볼린저 하단 반등 DCA (Bollinger DCA)';
  readonly description = '볼린저 하단선 이탈 후 양봉 전환 시 1차(50%), -1.8% 하락 시 2차(50%) 분할 매수 & +1.5% 익절';

  private takeProfitRate: number = 0.015;  // +1.5% 익절
  private stopLossRate: number = 0.028;    // -2.8% 최대 손절
  private step: number = 0;

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const { currentPrice, coinBalance, krwBalance, candles } = context;

    if (candles.length < 25) {
      return { action: 'HOLD', reason: '최소 25개 이상의 캔들 데이터 필요' };
    }

    const closes = candles.map((c) => c.trade_price);
    const bb = calculateBollingerBands(closes, 20, 2);
    const rsi = calculateRSI(closes, 14);

    const prevCandle = candles[candles.length - 2];
    const todayCandle = candles[candles.length - 1];

    const prevLower = bb.lower[bb.lower.length - 2];
    const curLower = bb.lower[bb.lower.length - 1];
    const curMiddle = bb.middle[bb.middle.length - 1];
    const curRsi = rsi[rsi.length - 1];

    const hasCoin = coinBalance && coinBalance.balance > 0.000001;

    // 미보유 상태: 1차 매수 탐색
    if (!hasCoin) {
      this.step = 0;
      // 전봉 저가가 하단선 이하 터치 & 현재 양봉 전환 & RSI 40 이하
      const isReboundSetup = prevCandle.low_price <= prevLower && currentPrice > todayCandle.opening_price && curRsi <= 40;

      if (isReboundSetup && krwBalance >= 5000) {
        this.step = 1;
        const buyAmount = Math.floor(krwBalance * 0.5); // 50% 1차 매수
        return {
          action: 'BUY',
          amountKrw: buyAmount,
          reason: `볼린저 하단 이탈 후 양봉 전환, 1차 분할 매수 (50%)`,
        };
      }

      return {
        action: 'HOLD',
        reason: `볼린저 하단(${Math.floor(curLower).toLocaleString()}) 반등 대기 (RSI: ${curRsi.toFixed(1)})`,
      };
    }

    // 코인 보유 중인 경우
    const avgPrice = coinBalance.avg_buy_price;
    const profitRate = (currentPrice - avgPrice) / avgPrice;

    // 1. 손절 검사
    if (profitRate <= -this.stopLossRate) {
      this.step = 0;
      return {
        action: 'SELL',
        volume: coinBalance.balance,
        reason: `최대 허용 손절선 도달 (${(profitRate * 100).toFixed(2)}% <= -${(this.stopLossRate * 100).toFixed(1)}%)`,
      };
    }

    // 2. 익절 검사: 중심선 회복 또는 +1.5% 달성
    if (currentPrice >= curMiddle || profitRate >= this.takeProfitRate) {
      this.step = 0;
      return {
        action: 'SELL',
        volume: coinBalance.balance,
        reason: `목표 익절 달성 (+${(profitRate * 100).toFixed(2)}%) 전량 차익 실현`,
      };
    }

    // 3. 2차 분할 매수 (-1.8% 추가 하락 시)
    if (this.step === 1 && profitRate <= -0.018 && krwBalance >= 5000) {
      this.step = 2;
      const buyAmount = Math.floor(krwBalance * 0.95); // 잔여 거의 전액
      return {
        action: 'BUY',
        amountKrw: buyAmount,
        reason: `평단가 대비 ${(profitRate * 100).toFixed(1)}% 추가 하락, 2차 물타기 매수`,
      };
    }

    return {
      action: 'HOLD',
      reason: `현재 수익률: ${(profitRate * 100).toFixed(2)}% (익절목표: +1.5% / 분할단계: ${this.step}단계)`,
    };
  }
}
