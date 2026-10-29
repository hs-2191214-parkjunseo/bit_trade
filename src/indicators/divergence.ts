import { Candle } from '../types/market.js';
import { calculateRSI } from './rsi.js';

export interface DivergenceResult {
  isBullishDivergence: boolean;
  rsiValue: number;
  reason?: string;
}

/**
 * 최근 15개 봉 기준 RSI 강세 다이버전스(Bullish Divergence) 감지
 */
export function checkBullishDivergence(candles: Candle[], rsiPeriod: number = 14): DivergenceResult {
  if (candles.length < 30) {
    return { isBullishDivergence: false, rsiValue: 50 };
  }

  const closes = candles.map((c) => c.trade_price);
  const rsi = calculateRSI(closes, rsiPeriod);
  if (rsi.length < 15) {
    return { isBullishDivergence: false, rsiValue: 50 };
  }

  const curRsi = rsi[rsi.length - 1];
  const curPrice = candles[candles.length - 1].trade_price;

  // 최근 15개 봉 중 최저점(과거 저점) 탐색
  const recentWindow = candles.slice(-15);
  const recentRsi = rsi.slice(-15);

  let minPriceIdx = 0;
  let minPrice = recentWindow[0].trade_price;
  for (let i = 1; i < recentWindow.length - 2; i++) {
    if (recentWindow[i].trade_price < minPrice) {
      minPrice = recentWindow[i].trade_price;
      minPriceIdx = i;
    }
  }

  const pastRsi = recentRsi[minPriceIdx];

  // 조건:
  // 1. 현재 가격이 과거 최저점 부근(또는 더 낮음)
  // 2. 현재 RSI가 과거 저점 RSI보다 유의미하게 높음 (+3포인트 이상)
  // 3. 현재 RSI가 과매도권(<= 42)
  if (curPrice <= minPrice * 1.008 && curRsi > pastRsi + 3 && curRsi <= 42) {
    return {
      isBullishDivergence: true,
      rsiValue: curRsi,
      reason: `RSI 강세 다이버전스 감지 (가격 신저가 갱신 중이나 RSI 저점 상승: ${pastRsi.toFixed(1)} -> ${curRsi.toFixed(1)})`,
    };
  }

  return { isBullishDivergence: false, rsiValue: curRsi };
}
