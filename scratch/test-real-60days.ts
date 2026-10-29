import { upbitClient } from '../src/market/upbit.rest.js';
import { PaperExchange } from '../src/exchange/paper.exchange.js';
import { calculateSMA, calculateEMA } from '../src/indicators/sma.js';
import { calculateRSI } from '../src/indicators/rsi.js';
import { calculateBollingerBands } from '../src/indicators/bollinger.js';

async function testReal60Days(market = 'KRW-BTC') {
  console.log(`\n======================================================`);
  console.log(`🚀 [실제 60일간의 60분봉 1000개 전수 백테스트] 마켓: ${market}`);
  console.log(`======================================================`);

  const coinSymbol = market.replace('KRW-', '');
  // 60일치 = 24시간 * 60일 = 1440개 (안전하게 800~1000개 수집)
  const candles = await upbitClient.getMinuteCandlesMulti(market, 60, 1000);
  console.log(`수집된 60분봉 캔들 수: ${candles.length}개 (기간: ${candles[0].candle_date_time_kst.slice(0, 10)} ~ ${candles[candles.length - 1].candle_date_time_kst.slice(0, 10)})`);

  const closes = candles.map(c => c.trade_price);
  const buyAndHoldReturn = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
  console.log(`단순 보유(Buy & Hold) 수익률: ${buyAndHoldReturn >= 0 ? '+' : ''}${buyAndHoldReturn.toFixed(2)}%\n`);

  // [전략 1] 슈퍼트렌드 EMA 추세추종 & 트레일링 익절
  const ex1 = new PaperExchange('EMA 추세 트레일링', 1000000, coinSymbol);
  let highestPrice1 = 0;

  for (let i = 50; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const candle = window[window.length - 1];
    const prevCandle = window[window.length - 2];
    const wCloses = window.map(c => c.trade_price);

    const ema9 = calculateEMA(wCloses, 9);
    const ema21 = calculateEMA(wCloses, 21);
    const ema50 = calculateEMA(wCloses, 50);
    const rsi = calculateRSI(wCloses, 14);

    const curEma9 = ema9[ema9.length - 1];
    const curEma21 = ema21[ema21.length - 1];
    const curEma50 = ema50[ema50.length - 1];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex1.getBalance(coinSymbol);
    const krwBal = (await ex1.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 매수 조건: 정배열 (9 > 21 > 50) 돌파 초입 & RSI 48~65 건강한 상승세
    const isBullishAlign = curEma9 > curEma21 && candle.trade_price >= curEma50;
    const isRsiHealthy = curRsi >= 48 && curRsi <= 65;
    const wasNotAlign = ema9[ema9.length - 2] <= ema21[ema21.length - 2] || window[window.length - 2].trade_price < ema50[ema50.length - 2];

    if (!hasCoin && isBullishAlign && isRsiHealthy && wasNotAlign && krwBal >= 5000) {
      highestPrice1 = candle.trade_price;
      await ex1.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: candle.trade_price,
      } as any, `EMA 정배열 골든크로스 & 상승 추세 진입`);
    }

    if (hasCoin) {
      highestPrice1 = Math.max(highestPrice1, candle.high_price);
      const avgPrice = coinBal.avg_buy_price;
      const profitRate = (candle.trade_price - avgPrice) / avgPrice;
      const peakGain = (highestPrice1 - avgPrice) / avgPrice;

      // 트레일링 스탑: +2.0% 이상 상승 후 최고점 대비 -0.8% 반락 시 차익 실현
      if (peakGain >= 0.02 && candle.trade_price <= highestPrice1 * 0.992) {
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `트레일링 익절 (최고점 ${((peakGain)*100).toFixed(1)}% 대비 반락)`);
      } else if (profitRate >= 0.035 || curRsi >= 75) { // +3.5% 상단 익절 또는 과열
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.018 || curEma9 < curEma21) { // 손절 -1.8% 또는 데드크로스
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `추세 이탈/손절 (-${((Math.abs(profitRate))*100).toFixed(2)}%)`);
      }
    }
  }

  // [전략 2] 볼린저 하단 + RSI 듀얼 과매도 반등 (Mean Reversion)
  const ex2 = new PaperExchange('볼린저 듀얼 과매도 반등', 1000000, coinSymbol);
  for (let i = 25; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const candle = window[window.length - 1];
    const prevCandle = window[window.length - 2];
    const wCloses = window.map(c => c.trade_price);

    const bb = calculateBollingerBands(wCloses, 20, 2);
    const rsi = calculateRSI(wCloses, 14);

    const curLower = bb.lower[bb.lower.length - 1];
    const curMid = bb.middle[bb.middle.length - 1];
    const curRsi = rsi[rsi.length - 1];
    const prevRsi = rsi[rsi.length - 2];

    const coinBal = await ex2.getBalance(coinSymbol);
    const krwBal = (await ex2.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 매수 조건: 전봉에서 볼린저 하단 이탈 또는 RSI < 32 투매 후, 현재봉에서 양봉 반등 시작
    const isOversold = prevCandle.low_price <= curLower || prevRsi <= 33;
    const isReversal = candle.trade_price > candle.opening_price && curRsi > prevRsi;

    if (!hasCoin && isOversold && isReversal && krwBal >= 5000) {
      await ex2.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: candle.trade_price,
      } as any, `과매도 투매 후 양봉 반등 (RSI: ${curRsi.toFixed(1)})`);
    }

    if (hasCoin) {
      const avgPrice = coinBal.avg_buy_price;
      const profitRate = (candle.trade_price - avgPrice) / avgPrice;

      // 익절: 볼린저 중심선 회복 또는 +1.8% 도달 시
      if (candle.trade_price >= curMid && profitRate >= 0.01) {
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `볼린저 중심선 도달 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate >= 0.025) {
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 +2.5% 익절`);
      } else if (profitRate <= -0.02) { // 손절 -2.0%
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `손절 (-2.0%)`);
      }
    }
  }

  // [전략 3] 스마트 2단계 눌림목 분할 매수 (DCA)
  const ex3 = new PaperExchange('스마트 2단계 눌림목 DCA', 1000000, coinSymbol);
  let step3 = 0;

  for (let i = 50; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const candle = window[window.length - 1];
    const wCloses = window.map(c => c.trade_price);

    const ema50 = calculateEMA(wCloses, 50);
    const rsi = calculateRSI(wCloses, 14);
    const curEma50 = ema50[ema50.length - 1];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex3.getBalance(coinSymbol);
    const krwBal = (await ex3.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 1차 진입: 대세선(50 EMA) 지지 구간(±1.5%) + RSI <= 38
    if (!hasCoin && candle.trade_price >= curEma50 * 0.985 && curRsi <= 38 && krwBal >= 5000) {
      step3 = 1;
      await ex3.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.45, // 45% 1차 매수
        currentPrice: candle.trade_price,
      } as any, `대세선 지지 & RSI 과매도 1차 매수`);
    } else if (hasCoin && step3 === 1 && krwBal >= 5000) {
      const drop = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (drop <= -0.018) { // 1.8% 추가 하락 시 2차 물타기
        step3 = 2;
        await ex3.createOrder({
          market,
          side: 'bid',
          ord_type: 'price',
          price: krwBal * 0.95,
          currentPrice: candle.trade_price,
        } as any, `1.8% 추가 하락 2차 분할 매수`);
      }
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (profitRate >= 0.018) { // +1.8% 전량 익절
        step3 = 0;
        await ex3.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.03) { // -3% 최종 손절
        step3 = 0;
        await ex3.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `손절 (-3.0%)`);
      }
    }
  }

  const lastPrice = candles[candles.length - 1].trade_price;
  console.table([
    ex1.getSummary(lastPrice),
    ex2.getSummary(lastPrice),
    ex3.getSummary(lastPrice),
  ].map(r => ({
    전략명: r.strategyName,
    최종평가금: `${Math.round(r.portfolioValue).toLocaleString()}원`,
    수익률: `${r.totalProfitRate >= 0 ? '+' : ''}${r.totalProfitRate.toFixed(2)}%`,
    MDD: `${r.maxDrawdown.toFixed(2)}%`,
    총체결: `${r.totalTrades}회`,
    청산승률: `${r.winRate.toFixed(1)}%`
  })));
}

async function run() {
  await testReal60Days('KRW-BTC');
  await testReal60Days('KRW-ETH');
  await testReal60Days('KRW-SOL');
  await testReal60Days('KRW-XRP');
}

run().catch(console.error);
