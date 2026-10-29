import { IStrategy, StrategyContext, StrategySignal } from '../types/strategy.js';

export class SmartDcaStrategy implements IStrategy {
  readonly name = '스마트 분할 매수 (Smart DCA / Grid)';
  readonly description = '낙폭 단계별 분할 매수(3단계: 30%, 30%, 40%) 및 평단가 대비 +2.5% 반등 시 익절';

  private dropSteps = [0.02, 0.04, 0.06]; // 1차: -2%, 2차: -4%, 3차: -6%
  private buyPortions = [0.3, 0.4, 1.0];  // 1차: 가용금액의 30%, 2차: 40%, 3차: 전액
  private takeProfitRate = 0.025;         // +2.5% 익절
  private maxStopLossRate = 0.08;         // -8.0% 전량 손절
  private step = 0;                       // 현재 진행 단계 (0: 미진입, 1: 1차매수완료, 2: 2차, 3: 3차)
  private peakPrice = 0;                  // 진입 전 고점 추적

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const { currentPrice, coinBalance, krwBalance, candles } = context;

    const hasCoin = coinBalance && coinBalance.balance > 0.000001;

    // 미보유 상태일 때 최근 고점 추적
    if (!hasCoin) {
      this.step = 0;
      if (candles.length > 0) {
        const recentCandles = candles.slice(-20);
        this.peakPrice = Math.max(...recentCandles.map((c) => c.high_price));
      } else {
        this.peakPrice = Math.max(this.peakPrice, currentPrice);
      }

      // 최근 고점 대비 -2% 이상 눌림목 발생 시 1차 진입
      const dropFromPeak = this.peakPrice > 0 ? (this.peakPrice - currentPrice) / this.peakPrice : 0;
      if (dropFromPeak >= this.dropSteps[0] && krwBalance >= 5000) {
        const orderKrw = Math.floor(krwBalance * this.buyPortions[0]);
        if (orderKrw >= 5000) {
          this.step = 1;
          return {
            action: 'BUY',
            amountKrw: orderKrw,
            reason: `고점(${this.peakPrice.toLocaleString()}) 대비 ${(dropFromPeak * 100).toFixed(1)}% 눌림 발생, 1차 분할 매수`,
          };
        }
      }

      return {
        action: 'HOLD',
        reason: `고점(${this.peakPrice.toLocaleString()}) 대비 눌림 대기 (현재: ${(dropFromPeak * 100).toFixed(1)}% / 목표: -2%)`,
      };
    }

    // 보유 중일 때
    const avgPrice = coinBalance.avg_buy_price;
    const returnRate = (currentPrice - avgPrice) / avgPrice;

    // 1. 최대 손절
    if (returnRate <= -this.maxStopLossRate) {
      this.step = 0;
      return {
        action: 'SELL',
        volume: coinBalance.balance,
        reason: `최대 허용 손절선 도달 (${(returnRate * 100).toFixed(2)}% <= -${(this.maxStopLossRate * 100).toFixed(2)}%)`,
      };
    }

    // 2. 목표 익절 (+2.5%)
    if (returnRate >= this.takeProfitRate) {
      this.step = 0;
      return {
        action: 'SELL',
        volume: coinBalance.balance,
        reason: `목표 수익률 달성 (+${(returnRate * 100).toFixed(2)}% >= +${(this.takeProfitRate * 100).toFixed(2)}%) 전량 익절`,
      };
    }

    // 3. 2차 분할 매수 (-4% 도달)
    if (this.step === 1 && returnRate <= -this.dropSteps[1] && krwBalance >= 5000) {
      const orderKrw = Math.floor(krwBalance * this.buyPortions[1]);
      if (orderKrw >= 5000) {
        this.step = 2;
        return {
          action: 'BUY',
          amountKrw: orderKrw,
          reason: `평단가 대비 ${(returnRate * 100).toFixed(1)}% 하락, 2차 분할 매수`,
        };
      }
    }

    // 4. 3차 분할 매수 (-6% 도달)
    if (this.step === 2 && returnRate <= -this.dropSteps[2] && krwBalance >= 5000) {
      const orderKrw = Math.floor(krwBalance * 0.98); // 잔여 KRW 거의 전액
      if (orderKrw >= 5000) {
        this.step = 3;
        return {
          action: 'BUY',
          amountKrw: orderKrw,
          reason: `평단가 대비 ${(returnRate * 100).toFixed(1)}% 하락, 3차 최종 물타기`,
        };
      }
    }

    return {
      action: 'HOLD',
      reason: `현재 수익률: ${(returnRate * 100).toFixed(2)}% (익절목표: +${(this.takeProfitRate * 100).toFixed(1)}% / 분할단계: ${this.step}단계)`,
    };
  }
}
