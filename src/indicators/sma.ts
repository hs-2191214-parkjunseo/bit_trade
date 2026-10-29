export function calculateSMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  if (prices.length < period) return result;

  for (let i = 0; i <= prices.length - period; i++) {
    const slice = prices.slice(i, i + period);
    const sum = slice.reduce((acc, val) => acc + val, 0);
    result.push(sum / period);
  }
  return result;
}

export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];

  const k = 2 / (period + 1);
  const result: number[] = [];

  // 초기값은 단순 이동평균
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  let prevEma = sum / period;
  result.push(prevEma);

  for (let i = period; i < prices.length; i++) {
    const currentEma = prices[i] * k + prevEma * (1 - k);
    result.push(currentEma);
    prevEma = currentEma;
  }
  return result;
}
