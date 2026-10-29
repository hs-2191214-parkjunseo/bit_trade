import { IStrategy, StrategyContext, StrategySignal } from '../types/strategy.js';
import { checkVolatilitySqueeze } from '../indicators/keltner.js';
import { calculateRSI } from '../indicators/rsi.js';

export class VolatilitySqueezeStrategy implements IStrategy {
  readonly name = '변동성 스퀴즈 폭발 (Volatility Squeeze)';
  readonly description = '볼린저 밴드가 켈트너 채널 안으로 압축된 후 상방 폭발 시 매수, +3.0% 익절';

  private wasSqueezed: boolean = false;
  private takeProfitRate: number = 0.030; // +3.0%
  private stopLossRate: number = 0.018;   // -1.8%

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const { currentPrice, coinBalance, krwBalance, candles } = context;

    if (candles.length < 30) {
      return { action: 'HOLD', reason: '최소 30개 이상의 캔들 데이터 필요' };
    }

    const squeezeInfo = checkVolatilitySqueeze(candles);
    const closes = candles.map((c) => c.trade_price);
    const rsi = calculateRSI(closes, 14);
    const curRsi = rsi[rsi.length - 1];

    const hasCoin = coinBalance && coinBalance.balance > 0.000001;

    // 1. 보유 중일 때: 익절 및 손절
    if (hasCoin && coinBalance.avg_buy_price > 0) {
      const profitRate = (currentPrice - coinBalance.avg_buy_price) / coinBalance.avg_buy_price;

      if (profitRate >= this.takeProfitRate || curRsi >= 75) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `스퀴즈 폭발 목표 익절 (+${(profitRate * 100).toFixed(2)}%)`,
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

    // 2. 미보유 상태: 스퀴즈 상태 추적 및 상방 분출 포착
    if (squeezeInfo.isSqueezed) {
      this.wasSqueezed = true;
    }

    // 조건: 이전에 에너지가 압축(스퀴즈)되었고, 현재 주가가 볼린저 상단선을 뚫으며 RSI가 52 이상으로 상방 분출
    const isBreakout = this.wasSqueezed && currentPrice >= squeezeInfo.bbUpper && curRsi >= 52 && curRsi <= 68;

    if (!hasCoin && isBreakout && krwBalance >= 5000) {
      this.wasSqueezed = false; // 진입 후 리셋
      return {
        action: 'BUY',
        amountKrw: Math.floor(krwBalance * 0.98),
        reason: `변동성 스퀴즈 에너지 응축 후 상단 밴드(${Math.floor(squeezeInfo.bbUpper).toLocaleString()}) 상방 폭발`,
      };
    }

    return {
      action: 'HOLD',
      reason: `스퀴즈 상태: ${squeezeInfo.isSqueezed ? '응축중(Squeezed)' : (this.wasSqueezed ? '폭발대기' : '정상')} / BB상단: ${Math.floor(squeezeInfo.bbUpper).toLocaleString()}`,
    };
  }
}
