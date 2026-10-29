import { IStrategy, StrategyContext, StrategySignal } from '../types/strategy.js';
import { calculateSMA, calculateEMA } from '../indicators/sma.js';

export class VolumeSpikeStrategy implements IStrategy {
  readonly name = '세력 거래량 폭발 (Volume Spike)';
  readonly description = '20봉 평균 거래량 대비 2.5배 폭증 + 강한 양봉 출현 시 세력 편승 매수, 트레일링 익절(+2.5%)';

  private takeProfitRate: number = 0.025; // +2.5% 기본 익절
  private stopLossRate: number = 0.015;   // -1.5% 타이트 손절
  private highestPrice: number = 0;

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const { currentPrice, coinBalance, krwBalance, candles } = context;

    if (candles.length < 25) {
      return { action: 'HOLD', reason: '최소 25개 이상의 캔들 데이터 필요' };
    }

    const volumes = candles.map((c) => c.candle_acc_trade_volume);
    const closes = candles.map((c) => c.trade_price);
    const volMa20 = calculateSMA(volumes, 20);
    const ema20 = calculateEMA(closes, 20);

    const prevCandle = candles[candles.length - 2];
    const todayCandle = candles[candles.length - 1];

    const curVol = todayCandle.candle_acc_trade_volume;
    const curVolMa = volMa20[volMa20.length - 1];
    const curEma20 = ema20[ema20.length - 1];

    const hasCoin = coinBalance && coinBalance.balance > 0.000001;

    // 1. 보유 중일 때: 익절 및 손절
    if (hasCoin && coinBalance.avg_buy_price > 0) {
      this.highestPrice = Math.max(this.highestPrice, currentPrice);
      const profitRate = (currentPrice - coinBalance.avg_buy_price) / coinBalance.avg_buy_price;
      const peakGain = (this.highestPrice - coinBalance.avg_buy_price) / coinBalance.avg_buy_price;

      // 트레일링 스탑 (+2.0% 이상 도달 후 최고점 대비 0.8% 반락 시 차익 실현)
      if (peakGain >= 0.02 && currentPrice <= this.highestPrice * 0.992) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `트레일링 익절 (최고수익 ${((peakGain)*100).toFixed(1)}% 대비 반락)`,
        };
      }

      // 목표 익절 (+2.5%)
      if (profitRate >= this.takeProfitRate) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `목표 익절 달성 (+${(profitRate * 100).toFixed(2)}%)`,
        };
      }

      // 손절 (-1.5%)
      if (profitRate <= -this.stopLossRate) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `손절선 도달 (${(profitRate * 100).toFixed(2)}% <= -${(this.stopLossRate * 100).toFixed(1)}%)`,
        };
      }
    }

    // 2. 미보유 상태: 세력 거래량 폭발 매수 탐색
    // 조건:
    // A. 거래량이 20봉 평균의 2.5배 이상 폭발
    // B. 주가가 20 EMA 위
    // C. 캔들 몸통이 0.8% 이상 상승한 강한 양봉
    const isVolumeSpike = curVol >= curVolMa * 2.5;
    const isAboveEma = currentPrice >= curEma20;
    const isStrongBullish = currentPrice >= todayCandle.opening_price * 1.008;

    if (!hasCoin && isVolumeSpike && isAboveEma && isStrongBullish && krwBalance >= 5000) {
      this.highestPrice = currentPrice;
      const volRatio = (curVol / curVolMa).toFixed(1);
      return {
        action: 'BUY',
        amountKrw: Math.floor(krwBalance * 0.98),
        reason: `거래량 ${volRatio}배 폭증 + 강한 양봉 세력 개입 매수`,
      };
    }

    const volRatioNow = curVolMa > 0 ? (curVol / curVolMa).toFixed(1) : '0';
    return {
      action: 'HOLD',
      reason: `거래량 배율: ${volRatioNow}배 (기준: 2.5배) / 20EMA: ${Math.floor(curEma20).toLocaleString()}`,
    };
  }
}
