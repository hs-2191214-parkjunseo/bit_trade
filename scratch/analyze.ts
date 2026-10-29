import { upbitClient } from '../src/market/upbit.rest.js';
import { calculateSMA, calculateEMA } from '../src/indicators/sma.js';
import { calculateRSI } from '../src/indicators/rsi.js';

async function analyzeMarket() {
  const daily = await upbitClient.getDailyCandles('KRW-BTC', 60);
  const minutes = await upbitClient.getMinuteCandles('KRW-BTC', 60, 200);

  console.log(`[시장 기본 분석]`);
  console.log(`일봉 개수: ${daily.length}`);
  console.log(`60일 전 시작가: ${daily[0].trade_price.toLocaleString()}원`);
  console.log(`현재가: ${daily[daily.length - 1].trade_price.toLocaleString()}원`);
  const buyAndHoldReturn = ((daily[daily.length - 1].trade_price - daily[0].trade_price) / daily[0].trade_price) * 100;
  console.log(`단순 보유(Buy & Hold) 수익률: ${buyAndHoldReturn.toFixed(2)}%`);
}

analyzeMarket().catch(console.error);
