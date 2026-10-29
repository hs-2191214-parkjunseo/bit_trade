import { upbitClient } from '../src/market/upbit.rest.js';
import { PaperExchange } from '../src/exchange/paper.exchange.js';
import { calculateSMA, calculateEMA } from '../src/indicators/sma.js';
import { calculateRSI } from '../src/indicators/rsi.js';
import { calculateBollingerBands } from '../src/indicators/bollinger.js';

async function testBtcPrecision() {
  const market = 'KRW-BTC';
  const minutes = await upbitClient.getMinuteCandles(market, 60, 200);
  const daily = await upbitClient.getDailyCandles(market, 60);

  console.log(`\n======================================================`);
  console.log(`🔍 [비트코인 정밀 최적화 백테스트]`);
  console.log(`======================================================`);

  // [전략 1] 스마트 스캘핑 (EMA 20선 지지 + RSI 35~45 턴어라운드 + 익절 +1.2%, 손절 -1.2%)
  const ex1 = new PaperExchange('EMA 지지 스캘핑', 1000000, 'BTC');
  for (let i = 25; i < minutes.length; i++) {
    const window = minutes.slice(0, i + 1);
    const candle = window[window.length - 1];
    const prevCandle = window[window.length - 2];
    const closes = window.map(c => c.trade_price);
    const ema20 = calculateEMA(closes, 20);
    const rsi = calculateRSI(closes, 14);

    const curEma = ema20[ema20.length - 1];
    const curRsi = rsi[rsi.length - 1];
    const prevRsi = rsi[rsi.length - 2];

    const coinBal = await ex1.getBalance('BTC');
    const krwBal = (await ex1.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 지지 반등 조건: 저가가 EMA20 부근까지 내려왔다가 종가가 EMA20 위로 마감 & RSI 반등
    const isSupportRebound = prevCandle.low_price <= curEma && candle.trade_price > curEma && curRsi > prevRsi && curRsi >= 40 && curRsi <= 58;

    if (!hasCoin && isSupportRebound && krwBal >= 5000) {
      await ex1.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: candle.trade_price,
      } as any, `EMA20 지지 양봉 반등`);
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (profitRate >= 0.012 || curRsi >= 68) { // +1.2% 익절
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.012) { // -1.2% 손절
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `손절 (-1.2%)`);
      }
    }
  }

  // [전략 2] 볼린저 하단 핀바(Hammer) 역추세 반등
  // 볼린저 하단선(20, 2)을 꼬리로 찌르고 말아올린 양봉 캔들 매수
  const ex2 = new PaperExchange('볼린저 하단 핀바 반등', 1000000, 'BTC');
  for (let i = 25; i < minutes.length; i++) {
    const window = minutes.slice(0, i + 1);
    const candle = window[window.length - 1];
    const closes = window.map(c => c.trade_price);
    const bb = calculateBollingerBands(closes, 20, 2);
    const rsi = calculateRSI(closes, 14);

    const lower = bb.lower[bb.lower.length - 1];
    const mid = bb.middle[bb.middle.length - 1];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex2.getBalance('BTC');
    const krwBal = (await ex2.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 꼬리 달고 말아올린 캔들: 저가는 하단선 이하, 종가는 하단선 위 & 시가보다 높은 양봉
    const isHammer = candle.low_price <= lower && candle.trade_price > lower && candle.trade_price > candle.opening_price && curRsi <= 45;

    if (!hasCoin && isHammer && krwBal >= 5000) {
      await ex2.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: candle.trade_price,
      } as any, `볼린저 하단 찌르고 말아올림 (양봉)`);
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (candle.trade_price >= mid || profitRate >= 0.015) {
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `중심선 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.015) {
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `손절 (-1.5%)`);
      }
    }
  }

  // [전략 3] 안전 마틴게일 DCA (2단계: -1.0% 시 물타기, +1.0% 반등 익절)
  const ex3 = new PaperExchange('초단기 세이프 DCA', 1000000, 'BTC');
  let step3 = 0;
  for (let i = 25; i < minutes.length; i++) {
    const window = minutes.slice(0, i + 1);
    const candle = window[window.length - 1];
    const closes = window.map(c => c.trade_price);
    const rsi = calculateRSI(closes, 14);
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex3.getBalance('BTC');
    const krwBal = (await ex3.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // RSI <= 36 에서 1차 40% 매수
    if (!hasCoin && curRsi <= 36 && krwBal >= 5000) {
      step3 = 1;
      await ex3.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.4,
        currentPrice: candle.trade_price,
      } as any, `RSI 과매도 1차 진입`);
    } else if (hasCoin && step3 === 1 && krwBal >= 5000) {
      const drop = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (drop <= -0.012) {
        step3 = 2;
        await ex3.createOrder({
          market,
          side: 'bid',
          ord_type: 'price',
          price: krwBal * 0.95,
          currentPrice: candle.trade_price,
        } as any, `1.2% 하락 2차 분할 매수`);
      }
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (profitRate >= 0.012) { // +1.2% 익절
        step3 = 0;
        await ex3.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.025) { // -2.5% 손절
        step3 = 0;
        await ex3.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `손절 (-2.5%)`);
      }
    }
  }

  const lastPrice = minutes[minutes.length - 1].trade_price;
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
    승률: `${r.winRate.toFixed(1)}%`
  })));
}

testBtcPrecision().catch(console.error);
