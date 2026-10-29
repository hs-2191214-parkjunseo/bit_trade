import { IStrategy, StrategyContext, StrategySignal } from '../types/strategy.js';

export class VolatilityBreakoutStrategy implements IStrategy {
  readonly name = '변동성 돌파 (Volatility Breakout)';
  readonly description = '전일 변동폭(고가-저가) × K 돌파 시 매수, 익일 09:00 전량 매도 (래리 윌리엄스)';

  private k: number;
  private targetPrice: number = 0;
  private currentDay: string = '';
  private boughtToday: boolean = false;
  private stopLossRate: number = 0.03; // -3% 손절

  constructor(k: number = 0.5, stopLossRate: number = 0.03) {
    this.k = k;
    this.stopLossRate = stopLossRate;
  }

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const { currentPrice, coinBalance, krwBalance, candles } = context;

    if (candles.length < 2) {
      return { action: 'HOLD', reason: '캔들 데이터 부족' };
    }

    const prevCandle = candles[candles.length - 2]; // 전일 캔들
    const todayCandle = candles[candles.length - 1]; // 당일 캔들 (또는 최근 일봉)

    // 날짜 변경 감지 (KST 기준)
    const todayDate = todayCandle.candle_date_time_kst.slice(0, 10);
    if (this.currentDay !== todayDate) {
      this.currentDay = todayDate;
      this.boughtToday = false;

      // 목표가 계산: 당일 시가 + (전일 변동폭 * K)
      const prevRange = prevCandle.high_price - prevCandle.low_price;
      this.targetPrice = todayCandle.opening_price + prevRange * this.k;
    }

    const hasCoin = coinBalance && coinBalance.balance > 0.000001;

    // 1. 손절 검사
    if (hasCoin && coinBalance.avg_buy_price > 0) {
      const dropRate = (currentPrice - coinBalance.avg_buy_price) / coinBalance.avg_buy_price;
      if (dropRate <= -this.stopLossRate) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `손절선 도달 (${(dropRate * 100).toFixed(2)}% <= -${(this.stopLossRate * 100).toFixed(2)}%)`,
        };
      }
    }

    // 2. 익일 오전 08:55 ~ 09:00 매도 (일봉 기준 갱신 직전 청산)
    const now = new Date();
    // UTC+9 기준 KST 시/분
    const kstHours = (now.getUTCHours() + 9) % 24;
    const kstMinutes = now.getUTCMinutes();
    if (hasCoin && kstHours === 8 && kstMinutes >= 55) {
      return {
        action: 'SELL',
        volume: coinBalance.balance,
        reason: '익일 장 시작 전(08:55) 당일 보유분 전량 청산',
      };
    }

    // 3. 목표가 돌파 매수
    if (!hasCoin && !this.boughtToday && this.targetPrice > 0 && currentPrice >= this.targetPrice) {
      if (krwBalance >= 5000) {
        this.boughtToday = true;
        return {
          action: 'BUY',
          amountKrw: Math.floor(krwBalance * 0.98), // 98% 매수 (수수료 여유)
          targetPrice: this.targetPrice,
          reason: `목표가 돌파 (${currentPrice.toLocaleString()} >= ${Math.floor(this.targetPrice).toLocaleString()})`,
        };
      }
    }

    return { action: 'HOLD', reason: `목표가: ${Math.floor(this.targetPrice).toLocaleString()} / 현재가: ${currentPrice.toLocaleString()}` };
  }
}
