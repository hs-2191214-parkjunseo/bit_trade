import { IStrategy, StrategyContext, StrategySignal } from '../types/strategy.js';
import { calculateSMA } from '../indicators/sma.js';

export class VolatilityBreakoutStrategy implements IStrategy {
  readonly name = '스마트 변동성 돌파 (Smart Breakout)';
  readonly description = '20선 추세 + 거래량 필터 + 동적K 돌파 매수 + 트레일링 익절(+1.8%) 및 타이트 손절(-1.5%)';

  private baseK: number;
  private stopLossRate: number;
  private takeProfitRate: number;
  private currentDay: string = '';
  private boughtToday: boolean = false;
  private targetPrice: number = 0;
  private highestPrice: number = 0;

  constructor(baseK: number = 0.35, stopLossRate: number = 0.015, takeProfitRate: number = 0.018) {
    this.baseK = baseK;
    this.stopLossRate = stopLossRate;
    this.takeProfitRate = takeProfitRate;
  }

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const { currentPrice, coinBalance, krwBalance, candles, market } = context;

    if (candles.length < 20) {
      return { action: 'HOLD', reason: '최소 20개 이상의 캔들 데이터 필요' };
    }

    const prevCandle = candles[candles.length - 2];
    const todayCandle = candles[candles.length - 1];
    const closes = candles.map((c) => c.trade_price);
    const volumes = candles.map((c) => c.candle_acc_trade_volume);

    const ma20 = calculateSMA(closes, 20);
    const curMa20 = ma20[ma20.length - 1];
    const volMa5 = calculateSMA(volumes, 5);
    const curVolMa5 = volMa5[volMa5.length - 1];

    const todayDate = todayCandle.candle_date_time_kst.slice(0, 10);
    if (this.currentDay !== todayDate) {
      this.currentDay = todayDate;
      this.boughtToday = false;
      this.highestPrice = 0;

      // 변동성이 큰 알트코인은 K를 약간 높여 휩쏘 방어, 비트코인은 0.35 적용
      const isAltcoin = !market.includes('BTC') && !market.includes('ETH');
      const k = isAltcoin ? 0.42 : this.baseK;

      const prevRange = prevCandle.high_price - prevCandle.low_price;
      this.targetPrice = todayCandle.opening_price + prevRange * k;
    }

    const hasCoin = coinBalance && coinBalance.balance > 0.000001;

    // 1. 보유 중일 때: 익절 및 손절 로직
    if (hasCoin && coinBalance.avg_buy_price > 0) {
      this.highestPrice = Math.max(this.highestPrice, currentPrice);
      const profitRate = (currentPrice - coinBalance.avg_buy_price) / coinBalance.avg_buy_price;
      const peakGain = (this.highestPrice - coinBalance.avg_buy_price) / coinBalance.avg_buy_price;

      // A. 목표 익절 (+1.8%)
      if (profitRate >= this.takeProfitRate) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `목표 익절 도달 (+${(profitRate * 100).toFixed(2)}%)`,
        };
      }

      // B. 트레일링 스탑: +1.5% 이상 올랐다가 고점 대비 0.8% 반락 시 차익 실현
      if (peakGain >= 0.015 && currentPrice <= this.highestPrice * 0.992) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `트레일링 익절 (최고점 ${((peakGain)*100).toFixed(1)}% 대비 반락)`,
        };
      }

      // C. 타이트 손절 (-1.5%)
      if (profitRate <= -this.stopLossRate) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `손절선 도달 (${(profitRate * 100).toFixed(2)}% <= -${(this.stopLossRate * 100).toFixed(1)}%)`,
        };
      }

      // D. 익일 장 시작 직전 청산
      const now = new Date();
      const kstHours = (now.getUTCHours() + 9) % 24;
      const kstMinutes = now.getUTCMinutes();
      if (kstHours === 8 && kstMinutes >= 55) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: '익일 장 시작 전(08:55) 당일 보유분 전량 청산',
        };
      }
    }

    // 2. 미보유 상태: 20선 위 상승 추세 + 거래량 지지 + 목표가 돌파 시 매수
    const isAboveMa20 = todayCandle.opening_price >= curMa20 * 0.995;
    const isVolumeHealthy = todayCandle.candle_acc_trade_volume >= curVolMa5 * 0.8;

    if (!hasCoin && !this.boughtToday && isAboveMa20 && isVolumeHealthy && this.targetPrice > 0 && currentPrice >= this.targetPrice) {
      if (krwBalance >= 5000) {
        this.boughtToday = true;
        this.highestPrice = currentPrice;
        return {
          action: 'BUY',
          amountKrw: Math.floor(krwBalance * 0.98),
          targetPrice: this.targetPrice,
          reason: `20선 위 상승추세 & 목표가 돌파 (${currentPrice.toLocaleString()} >= ${Math.floor(this.targetPrice).toLocaleString()})`,
        };
      }
    }

    return {
      action: 'HOLD',
      reason: `목표가: ${Math.floor(this.targetPrice).toLocaleString()} / 현재가: ${currentPrice.toLocaleString()} / 20MA: ${Math.floor(curMa20).toLocaleString()}`,
    };
  }
}
