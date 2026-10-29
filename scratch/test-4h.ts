import { upbitClient } from '../src/market/upbit.rest.js';
import { PaperExchange } from '../src/exchange/paper.exchange.js';
import { calculateSMA, calculateEMA } from '../src/indicators/sma.js';
import { calculateRSI } from '../src/indicators/rsi.js';
import { calculateBollingerBands } from '../src/indicators/bollinger.js';

async function test4HourCandles(market = 'KRW-BTC') {
  console.log(`\n======================================================`);
  console.log(`🏆 [4시간봉(240분봉) 기반 60일 프로 퀀트 백테스트] 마켓: ${market}`);
  console.log(`======================================================`);

  const coinSymbol = market.replace('KRW-', '');
  // 60일 = 60 * 6 = 360개 4시간봉
  const candles = await upbitClient.getMinuteCandles(market, 240, 200);
  console.log(`수집된 4시간봉 수: ${candles.length}개 (${candles[0].candle_date_time_kst.slice(0, 10)} ~ ${candles[candles.length - 1].candle_date_time_kst.slice(0, 10)})`);

  const closes = candles.map(c => c.trade_price);
  const buyAndHold = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
  console.log(`단순 보유(Buy & Hold) 수익률: ${buyAndHold >= 0 ? '+' : ''}${buyAndHold.toFixed(2)}%\n`);

  // [전략 1] 4시간봉 MACD / EMA 모멘텀 추세추종 (Golden Swing)
  // 단기(7 EMA)가 장기(20 EMA)를 골든크로스하고 RSI가 45~65일 때 매수
  // 익절: +3.0% 달성 시 또는 트레일링 스탑, 손절 -2.0%
  const ex1 = new PaperExchange('4H EMA 추세 스윙', 1000000, coinSymbol);
  for (let i = 20; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const candle = window[window.length - 1];
    const prevCandle = window[window.length - 2];
    const wCloses = window.map(c => c.trade_price);

    const ema7 = calculateEMA(wCloses, 7);
    const ema20 = calculateEMA(wCloses, 20);
    const rsi = calculateRSI(wCloses, 14);

    const cur7 = ema7[ema7.length - 1];
    const prev7 = ema7[ema7.length - 2];
    const cur20 = ema20[ema20.length - 1];
    const prev20 = ema20[ema20.length - 2];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex1.getBalance(coinSymbol);
    const krwBal = (await ex1.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 골든크로스 + 건강한 모멘텀
    const isGolden = prev7 <= prev20 && cur7 > cur20;
    if (!hasCoin && isGolden && curRsi >= 45 && curRsi <= 65 && krwBal >= 5000) {
      await ex1.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: candle.trade_price,
      } as any, `4H EMA 골든크로스 (RSI: ${curRsi.toFixed(1)})`);
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      const isDead = prev7 >= prev20 && cur7 < cur20;

      if (profitRate >= 0.03 || curRsi >= 72) { // +3.0% 익절
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.02 || isDead) { // -2% 손절 또는 데드크로스
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `손절/추세이탈 (${(profitRate * 100).toFixed(2)}%)`);
      }
    }
  }

  // [전략 2] 4시간봉 볼린저 밴드 하단 반등 (BB Mean Reversion)
  const ex2 = new PaperExchange('4H 볼린저 하단 반등', 1000000, coinSymbol);
  for (let i = 20; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const candle = window[window.length - 1];
    const prevCandle = window[window.length - 2];
    const wCloses = window.map(c => c.trade_price);

    const bb = calculateBollingerBands(wCloses, 20, 2);
    const rsi = calculateRSI(wCloses, 14);

    const lower = bb.lower[bb.lower.length - 1];
    const mid = bb.middle[bb.middle.length - 1];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex2.getBalance(coinSymbol);
    const krwBal = (await ex2.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 볼린저 하단 밴드 터치 + 양봉 반등 또는 RSI <= 38
    const isTouchAndBounce = (candle.low_price <= lower || curRsi <= 38) && candle.trade_price > candle.opening_price;
    if (!hasCoin && isTouchAndBounce && krwBal >= 5000) {
      await ex2.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: candle.trade_price,
      } as any, `4H 볼린저 하단 양봉 반등`);
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (candle.trade_price >= mid || profitRate >= 0.025) { // 중심선 도달 또는 +2.5%
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `중심선 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.025) { // -2.5% 손절
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `손절 (-2.5%)`);
      }
    }
  }

  // [전략 3] 4시간봉 스마트 분할 매수 DCA (안전 방어형)
  const ex3 = new PaperExchange('4H 스마트 분할매수 DCA', 1000000, coinSymbol);
  let step3 = 0;
  for (let i = 20; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const candle = window[window.length - 1];
    const wCloses = window.map(c => c.trade_price);
    const rsi = calculateRSI(wCloses, 14);
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex3.getBalance(coinSymbol);
    const krwBal = (await ex3.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // RSI <= 40 에서 1차 매수 (40%)
    if (!hasCoin && curRsi <= 40 && krwBal >= 5000) {
      step3 = 1;
      await ex3.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.45,
        currentPrice: candle.trade_price,
      } as any, `4H 과매도 1차 분할 매수`);
    } else if (hasCoin && step3 === 1 && krwBal >= 5000) {
      const drop = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (drop <= -0.02) { // 2% 추가 하락 시 2차 물타기
        step3 = 2;
        await ex3.createOrder({
          market,
          side: 'bid',
          ord_type: 'price',
          price: krwBal * 0.95,
          currentPrice: candle.trade_price,
        } as any, `2% 하락 2차 분할 매수`);
      }
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (profitRate >= 0.02) { // +2.0% 익절
        step3 = 0;
        await ex3.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.035) { // -3.5% 손절
        step3 = 0;
        await ex3.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `손절 (-3.5%)`);
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
  await test4HourCandles('KRW-BTC');
  await test4HourCandles('KRW-ETH');
  await test4HourCandles('KRW-SOL');
  await test4HourCandles('KRW-XRP');
}

run().catch(console.error);
