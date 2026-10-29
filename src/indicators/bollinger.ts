import { calculateSMA } from './sma.js';

export interface BollingerBands {
  upper: number[];
  middle: number[];
  lower: number[];
}

export function calculateBollingerBands(prices: number[], period: number = 20, multiplier: number = 2): BollingerBands {
  const middle = calculateSMA(prices, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < middle.length; i++) {
    const slice = prices.slice(i, i + period);
    const mean = middle[i];
    const variance = slice.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    upper.push(mean + stdDev * multiplier);
    lower.push(mean - stdDev * multiplier);
  }

  return { upper, middle, lower };
}
