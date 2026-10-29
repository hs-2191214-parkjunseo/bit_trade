import { Candle } from '../types/market.js';

export function calculateATR(candles: Candle[], period: number = 14): number[] {
  if (candles.length <= period) return [];

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high_price - cur.low_price,
      Math.abs(cur.high_price - prev.trade_price),
      Math.abs(cur.low_price - prev.trade_price)
    );
    trs.push(tr);
  }

  // 초기 ATR은 단순 이동평균
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += trs[i];
  }
  let prevAtr = sum / period;
  const atrs: number[] = [prevAtr];

  // 와일더 평활법 (Wilder's Smoothing)
  for (let i = period; i < trs.length; i++) {
    const curAtr = (prevAtr * (period - 1) + trs[i]) / period;
    atrs.push(curAtr);
    prevAtr = curAtr;
  }

  return atrs;
}
