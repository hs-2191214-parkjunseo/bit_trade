import { upbitClient } from '../src/market/upbit.rest.js';

async function checkCandles() {
  const daily = await upbitClient.getDailyCandles('KRW-BTC', 60);
  console.log(`첫번째 날짜: ${daily[0].candle_date_time_kst}, 시가: ${daily[0].opening_price}, 종가: ${daily[0].trade_price}`);
  console.log(`최고가 날짜: ${daily.reduce((max, c) => c.high_price > max.high_price ? c : max).candle_date_time_kst}, 최고가: ${Math.max(...daily.map(c => c.high_price))}`);
  console.log(`최저가 날짜: ${daily.reduce((min, c) => c.low_price < min.low_price ? c : min).candle_date_time_kst}, 최저가: ${Math.min(...daily.map(c => c.low_price))}`);
  console.log(`마지막 날짜: ${daily[daily.length - 1].candle_date_time_kst}, 시가: ${daily[daily.length - 1].opening_price}, 종가: ${daily[daily.length - 1].trade_price}`);
}

checkCandles();
