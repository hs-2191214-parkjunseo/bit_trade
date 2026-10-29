import { Candle } from '../types/market.js';
import { calculateEMA } from './sma.js';
import { calculateATR } from './atr.js';
import { calculateBollingerBands } from './bollinger.js';

export interface KeltnerChannel {
  upper: number[];
  middle: number[];
  lower: number[];
}

export function calculateKeltnerChannel(candles: Candle[], period: number = 20, atrMultiplier: number = 1.5): KeltnerChannel {
  const closes = candles.map((c) => c.trade_price);
  const middle = calculateEMA(closes, period);
  const atrs = calculateATR(candles, 14);

  const upper: number[] = [];
  const lower: number[] = [];

  const minLen = Math.min(middle.length, atrs.length);
  const midOffset = middle.length - minLen;
  const atrOffset = atrs.length - minLen;

  for (let i = 0; i < minLen; i++) {
    const mid = middle[midOffset + i];
    const atr = atrs[atrOffset + i];
    upper.push(mid + atr * atrMultiplier);
    lower.push(mid - atr * atrMultiplier);
  }

  return {
    upper,
    middle: middle.slice(midOffset),
    lower,
  };
}

export interface SqueezeResult {
  isSqueezed: boolean;
  bbUpper: number;
  bbLower: number;
  kcUpper: number;
  kcLower: number;
}

/**
 * 볼린저 밴드가 켈트너 채널 안으로 들어가는 에너지 응축(Squeeze) 감지
 */
export function checkVolatilitySqueeze(candles: Candle[]): SqueezeResult {
  if (candles.length < 25) {
    return { isSqueezed: false, bbUpper: 0, bbLower: 0, kcUpper: 0, kcLower: 0 };
  }

  const closes = candles.map((c) => c.trade_price);
  const bb = calculateBollingerBands(closes, 20, 2);
  const kc = calculateKeltnerChannel(candles, 20, 1.5);

  const bbUp = bb.upper[bb.upper.length - 1];
  const bbLow = bb.lower[bb.lower.length - 1];
  const kcUp = kc.upper[kc.upper.length - 1];
  const kcLow = kc.lower[kc.lower.length - 1];

  // 볼린저 밴드가 켈트너 채널 내부에 완전히 갇힌 상태
  const isSqueezed = bbUp <= kcUp && bbLow >= kcLow;

  return {
    isSqueezed,
    bbUpper: bbUp,
    bbLower: bbLow,
    kcUpper: kcUp,
    kcLower: kcLow,
  };
}
