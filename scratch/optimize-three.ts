import { upbitClient } from '../src/market/upbit.rest.js';
import { PaperExchange } from '../src/exchange/paper.exchange.js';
import { calculateSMA, calculateEMA } from '../src/indicators/sma.js';
import { calculateRSI } from '../src/indicators/rsi.js';
import { calculateBollingerBands } from '../src/indicators/bollinger.js';

async function optimizeAllThree(market = 'KRW-BTC') {
  const coinSymbol = market.replace('KRW-', '');
  const minutes = await upbitClient.getMinuteCandles(market, 60, 200);
  const daily = await upbitClient.getDailyCandles(market, 60);

  // [전략 1] 모멘텀 스캘핑 돌파 (K=0.35, MA5 필터, +1.5% 당일 익절, -1.5% 손절)
  const ex1 = new PaperExchange('모멘텀 스캘핑 돌파', 1000000, coinSymbol);
  let cDay = '';
  let cBought = false;
  for (let i = 5; i < daily.length; i++) {
    const window = daily.slice(0, i + 1);
    const today = window[window.length - 1];
    const prev = window[window.length - 2];
    const closes = window.map(c => c.trade_price);
    const ma5 = calculateSMA(closes, 5);
    const curMa5 = ma5[ma5.length - 1];

    const todayDate = today.candle_date_time_kst.slice(0, 10);
    if (cDay !== todayDate) {
      cDay = todayDate;
      cBought = false;
    }

    const prevRange = prev.high_price - prev.low_price;
    const target = today.opening_price + prevRange * 0.35;

    const coinBal = await ex1.getBalance(coinSymbol);
    const krwBal = (await ex1.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    if (!hasCoin && !cBought && today.high_price >= target && today.opening_price >= curMa5 * 0.995 && krwBal >= 5000) {
      cBought = true;
      const entryPrice = target;
      await ex1.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: entryPrice,
      } as any, `K=0.35 모멘텀 돌파 진입`);

      const updatedCoin = await ex1.getBalance(coinSymbol);
      const maxPossibleGain = (today.high_price - entryPrice) / entryPrice;
      const minPossibleGain = (today.low_price - entryPrice) / entryPrice;

      if (maxPossibleGain >= 0.015) {
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: updatedCoin.balance,
          currentPrice: entryPrice * 1.015,
        } as any, `장중 +1.5% 목표 달성 익절`);
      } else if (minPossibleGain <= -0.015) {
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: updatedCoin.balance,
          currentPrice: entryPrice * 0.985,
        } as any, `장중 -1.5% 손절`);
      } else {
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: updatedCoin.balance,
          currentPrice: today.trade_price,
        } as any, `당일 종가 마감 청산`);
      }
    }
  }

  // [전략 2] 볼린저 밴드 하단 반등 & 중심선 익절 (Mean Reversion Swing)
  // 조건: 60분봉에서 볼린저 밴드 하단(20, 2) 터치 + RSI < 35 과매도 발생 시 진입
  // 익절: 볼린저 중심선(SMA 20) 회복 또는 +1.8% 반등 시 익절
  // 손절: -2.5% 타이트 손절
  const ex2 = new PaperExchange('볼린저 하단 반등 스윙', 1000000, coinSymbol);
  for (let i = 25; i < minutes.length; i++) {
    const window = minutes.slice(0, i + 1);
    const candle = window[window.length - 1];
    const prevCandle = window[window.length - 2];
    const closes = window.map(c => c.trade_price);
    const bb = calculateBollingerBands(closes, 20, 2);
    const rsi = calculateRSI(closes, 14);

    const lowerBand = bb.lower[bb.lower.length - 1];
    const middleBand = bb.middle[bb.middle.length - 1];
    const curRsi = rsi[rsi.length - 1];
    const prevRsi = rsi[rsi.length - 2];

    const coinBal = await ex2.getBalance(coinSymbol);
    const krwBal = (await ex2.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 매수: 전봉이 하단 터치 후 현재봉 양봉 반등 또는 RSI 35 이하 터치 후 반등
    const isRebound = (candle.low_price <= lowerBand || curRsi <= 35) && candle.trade_price > candle.opening_price;
    if (!hasCoin && isRebound && krwBal >= 5000) {
      await ex2.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: candle.trade_price,
      } as any, `볼린저 하단 터치 후 양봉 반등 (RSI: ${curRsi.toFixed(1)})`);
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      // 볼린저 중심선 도달 시 또는 +1.5% 이상 수익 시 익절
      if (candle.trade_price >= middleBand && profitRate >= 0.008) {
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `중심선 회복 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate >= 0.02) {
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 +2.0% 익절`);
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

  // [전략 3] 스마트 RSI 눌림목 분할매수 (Smart Pullback DCA)
  // 조건: 60분봉 기준 EMA 50 장기 상승 추세 위에서 RSI가 40 이하로 눌릴 때 1차(40%), 추가 -1.5% 눌릴 때 2차(60%)
  // 익절: 평단가 대비 +1.5% 도달 시 전량 익절
  // 손절: 평단가 대비 -3.0%
  const ex3 = new PaperExchange('스마트 눌림목 DCA', 1000000, coinSymbol);
  let step3 = 0;
  for (let i = 50; i < minutes.length; i++) {
    const window = minutes.slice(0, i + 1);
    const candle = window[window.length - 1];
    const closes = window.map(c => c.trade_price);
    const ema50 = calculateEMA(closes, 50);
    const rsi = calculateRSI(closes, 14);

    const curEma50 = ema50[ema50.length - 1];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex3.getBalance(coinSymbol);
    const krwBal = (await ex3.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 1차 매수: EMA50 부근 이상이면서 RSI <= 40
    if (!hasCoin && candle.trade_price >= curEma50 * 0.98 && curRsi <= 40 && krwBal >= 5000) {
      step3 = 1;
      await ex3.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.4,
        currentPrice: candle.trade_price,
      } as any, `1차 눌림목 진입 (RSI: ${curRsi.toFixed(1)})`);
    } else if (hasCoin && step3 === 1 && krwBal >= 5000) {
      const drop = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (drop <= -0.015) {
        step3 = 2;
        await ex3.createOrder({
          market,
          side: 'bid',
          ord_type: 'price',
          price: krwBal * 0.95,
          currentPrice: candle.trade_price,
        } as any, `2차 분할 매수 (-1.5% 추가 눌림)`);
      }
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (profitRate >= 0.015) {
        step3 = 0;
        await ex3.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.03) {
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

  const lastPrice = minutes[minutes.length - 1].trade_price;
  console.log(`\n📊 [결과 요약 - ${market}]`);
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

async function run() {
  await optimizeAllThree('KRW-BTC');
  await optimizeAllThree('KRW-ETH');
  await optimizeAllThree('KRW-SOL');
}

run().catch(console.error);
