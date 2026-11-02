import { IStrategy, StrategyContext, StrategySignal } from '../types/strategy.js';
import { calculateSMA, calculateEMA } from '../indicators/sma.js';
import { calculateATR } from '../indicators/atr.js';

export class VolumeSpikeStrategy implements IStrategy {
  readonly name = '세력 거래량 폭발 (Volume Spike)';
  readonly description = '대추세(50 EMA) 지지 + 20봉 평균 거래량 대비 2.2배 폭증 + 강한 양봉 출현 시 편승 매수, ATR 동적 익절/손절';

  private takeProfitRate: number = 0.028; // +2.8% 목표 익절
  private stopLossRate: number = 0.022;   // -2.2% 동적 안전 손절
  private highestPrice: number = 0;

  constructor(takeProfitRate: number = 0.028, stopLossRate: number = 0.022) {
    this.takeProfitRate = takeProfitRate;
    this.stopLossRate = stopLossRate;
  }

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const { currentPrice, coinBalance, krwBalance, candles } = context;

    if (candles.length < 50) {
      return { action: 'HOLD', reason: '최소 50개 이상의 캔들 데이터 필요' };
    }

    const volumes = candles.map((c) => c.candle_acc_trade_volume);
    const closes = candles.map((c) => c.trade_price);
    const volMa20 = calculateSMA(volumes, 20);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const atrs = calculateATR(candles, 14);

    const todayCandle = candles[candles.length - 1];

    const curVol = todayCandle.candle_acc_trade_volume;
    const curVolMa = volMa20[volMa20.length - 1];
    const curEma20 = ema20[ema20.length - 1];
    const curEma50 = ema50[ema50.length - 1];

    // ATR 기반 동적 손절/익절 배율 산출
    const curAtr = atrs.length > 0 ? atrs[atrs.length - 1] : currentPrice * 0.015;
    const atrRatio = curAtr / currentPrice;
    const dynamicSl = Math.max(0.018, Math.min(0.028, atrRatio * 1.5));
    const dynamicTp = Math.max(0.025, Math.min(0.040, atrRatio * 2.2));

    const hasCoin = coinBalance && coinBalance.balance > 0.000001;

    // 1. 보유 중일 때: 익절 및 손절
    if (hasCoin && coinBalance.avg_buy_price > 0) {
      this.highestPrice = Math.max(this.highestPrice, currentPrice);
      const profitRate = (currentPrice - coinBalance.avg_buy_price) / coinBalance.avg_buy_price;
      const peakGain = (this.highestPrice - coinBalance.avg_buy_price) / coinBalance.avg_buy_price;

      // 트레일링 스탑 (+2.0% 이상 도달 후 최고점 대비 1.0% 반락 시 차익 실현)
      if (peakGain >= 0.020 && currentPrice <= this.highestPrice * 0.990) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `트레일링 익절 (최고수익 ${((peakGain) * 100).toFixed(1)}% 대비 반락)`,
        };
      }

      // 목표 익절
      if (profitRate >= dynamicTp) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `목표 익절 달성 (+${(profitRate * 100).toFixed(2)}% >= ${(dynamicTp * 100).toFixed(1)}%)`,
        };
      }

      // 동적 손절
      if (profitRate <= -dynamicSl) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `동적 손절선 도달 (${(profitRate * 100).toFixed(2)}% <= -${(dynamicSl * 100).toFixed(1)}%)`,
        };
      }
    }

    // 2. 미보유 상태: 세력 거래량 폭발 매수 탐색
    // 조건:
    // A. 거래량이 20봉 평균의 2.2배 이상 폭발
    // B. [대추세 필터]: 주가가 50 EMA 이상이거나 20 EMA가 50 EMA 이상인 정배열/상승추세 (역배열 상투 배제)
    // C. 캔들 몸통이 0.7% 이상 상승한 확실한 양봉
    const isVolumeSpike = curVol >= curVolMa * 2.2;
    const isUptrend = currentPrice >= curEma50 || curEma20 >= curEma50;
    const isStrongBullish = currentPrice >= todayCandle.opening_price * 1.007;

    if (!hasCoin && isVolumeSpike && isUptrend && isStrongBullish && krwBalance >= 5000) {
      this.highestPrice = currentPrice;
      const volRatio = curVolMa > 0 ? (curVol / curVolMa).toFixed(1) : '2.2';
      return {
        action: 'BUY',
        amountKrw: Math.floor(krwBalance * 0.98),
        reason: `대추세(50EMA) 지지 + 거래량 ${volRatio}배 폭증 세력 편승 매수`,
      };
    }

    const volRatioNow = curVolMa > 0 ? (curVol / curVolMa).toFixed(1) : '0';
    return {
      action: 'HOLD',
      reason: `거래량: ${volRatioNow}배 (기준: 2.2배) / 50EMA: ${Math.floor(curEma50).toLocaleString()} / 추세: ${isUptrend ? '상승' : '하락/배제'}`,
    };
  }
}
