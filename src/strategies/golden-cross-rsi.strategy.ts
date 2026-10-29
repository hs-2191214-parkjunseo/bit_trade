import { IStrategy, StrategyContext, StrategySignal } from '../types/strategy.js';
import { calculateSMA } from '../indicators/sma.js';
import { calculateRSI } from '../indicators/rsi.js';

export class GoldenCrossRsiStrategy implements IStrategy {
  readonly name = '이평선 골든크로스 + RSI (MA Cross & RSI)';
  readonly description = '단기(7선) / 장기(20선) 골든크로스 및 RSI 필터 매수, 데드크로스 또는 RSI 70 초과 시 매도';

  private shortPeriod: number;
  private longPeriod: number;
  private rsiPeriod: number;
  private stopLossRate: number;

  constructor(shortPeriod: number = 7, longPeriod: number = 20, rsiPeriod: number = 14, stopLossRate: number = 0.035) {
    this.shortPeriod = shortPeriod;
    this.longPeriod = longPeriod;
    this.rsiPeriod = rsiPeriod;
    this.stopLossRate = stopLossRate;
  }

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const { currentPrice, coinBalance, krwBalance, candles } = context;

    if (candles.length < this.longPeriod + 5) {
      return { action: 'HOLD', reason: `최소 ${this.longPeriod + 5}개 이상의 캔들 필요` };
    }

    const closePrices = candles.map((c) => c.trade_price);
    const shortSma = calculateSMA(closePrices, this.shortPeriod);
    const longSma = calculateSMA(closePrices, this.longPeriod);
    const rsi = calculateRSI(closePrices, this.rsiPeriod);

    if (shortSma.length < 2 || longSma.length < 2 || rsi.length < 1) {
      return { action: 'HOLD', reason: '지표 계산 데이터 불충분' };
    }

    const currentShort = shortSma[shortSma.length - 1];
    const prevShort = shortSma[shortSma.length - 2];

    const currentLong = longSma[longSma.length - 1];
    const prevLong = longSma[longSma.length - 2];

    const currentRsi = rsi[rsi.length - 1];

    const hasCoin = coinBalance && coinBalance.balance > 0.000001;

    // 1. 손절 체크
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

    // 골든크로스 판정: 이전에는 단기 <= 장기, 현재는 단기 > 장기
    const isGoldenCross = prevShort <= prevLong && currentShort > currentLong;
    // 데드크로스 판정: 이전에는 단기 >= 장기, 현재는 단기 < 장기
    const isDeadCross = prevShort >= prevLong && currentShort < currentLong;

    // 2. 매도 조건: 데드크로스 발생 또는 RSI 과매수(75 초과)
    if (hasCoin) {
      if (isDeadCross) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `데드크로스 발생 (단기 ${Math.floor(currentShort)} < 장기 ${Math.floor(currentLong)})`,
        };
      }
      if (currentRsi >= 75) {
        return {
          action: 'SELL',
          volume: coinBalance.balance,
          reason: `RSI 과매수권 도달 (${currentRsi.toFixed(1)} >= 75) 익절`,
        };
      }
    }

    // 3. 매수 조건: 골든크로스 + RSI 건전 구간(35 ~ 65)
    if (!hasCoin && isGoldenCross && currentRsi >= 35 && currentRsi <= 65) {
      if (krwBalance >= 5000) {
        return {
          action: 'BUY',
          amountKrw: Math.floor(krwBalance * 0.98),
          reason: `골든크로스 달성 (단기 ${Math.floor(currentShort)} > 장기 ${Math.floor(currentLong)}) & RSI: ${currentRsi.toFixed(1)}`,
        };
      }
    }

    return {
      action: 'HOLD',
      reason: `단기MA: ${Math.floor(currentShort)} / 장기MA: ${Math.floor(currentLong)} / RSI: ${currentRsi.toFixed(1)}`,
    };
  }
}
