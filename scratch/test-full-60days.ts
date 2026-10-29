import { upbitClient } from '../src/market/upbit.rest.js';
import { PaperExchange } from '../src/exchange/paper.exchange.js';
import { calculateSMA, calculateEMA } from '../src/indicators/sma.js';
import { calculateRSI } from '../src/indicators/rsi.js';
import { calculateBollingerBands } from '../src/indicators/bollinger.js';

async function testFull60DaysDaily(market = 'KRW-BTC') {
  console.log(`\n======================================================`);
  console.log(`🚀 [진짜 60일 일봉 기준 백테스트] 마켓: ${market}`);
  console.log(`======================================================`);

  const coinSymbol = market.replace('KRW-', '');
  const daily = await upbitClient.getDailyCandles(market, 60);

  // 1. [스마트 변동성 돌파 (MA5 필터 + 당일 +2% 익절 + -1.5% 손절)]
  const ex1 = new PaperExchange('스마트 변동성 돌파', 1000000, coinSymbol);
  for (let i = 5; i < daily.length; i++) {
    const window = daily.slice(0, i + 1);
    const today = window[window.length - 1];
    const prev = window[window.length - 2];
    const closes = window.map(c => c.trade_price);
    const ma5 = calculateSMA(closes, 5);
    const curMa5 = ma5[ma5.length - 1];

    const prevRange = prev.high_price - prev.low_price;
    const target = today.opening_price + prevRange * 0.4; // K=0.4
    const isAboveMa5 = today.opening_price >= curMa5 * 0.995;

    const coinBal = await ex1.getBalance(coinSymbol);
    const krwBal = (await ex1.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    if (!hasCoin && isAboveMa5 && today.high_price >= target && krwBal >= 5000) {
      const entryPrice = target;
      await ex1.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: entryPrice,
      } as any, `K=0.4 돌파 진입`);

      const updatedCoin = await ex1.getBalance(coinSymbol);
      const maxGain = (today.high_price - entryPrice) / entryPrice;
      const minGain = (today.low_price - entryPrice) / entryPrice;

      if (maxGain >= 0.02) { // 장중 +2% 달성 시 익절
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: updatedCoin.balance,
          currentPrice: entryPrice * 1.02,
        } as any, `목표 +2.0% 익절`);
      } else if (minGain <= -0.015) { // -1.5% 손절
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: updatedCoin.balance,
          currentPrice: entryPrice * 0.985,
        } as any, `손절 (-1.5%)`);
      } else {
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: updatedCoin.balance,
          currentPrice: today.trade_price,
        } as any, `종가 마감`);
      }
    }
  }

  // 2. [추세 추종 EMA 5선 / 20선 크로스 + RSI]
  const ex2 = new PaperExchange('EMA 크로스 추세추종', 1000000, coinSymbol);
  for (let i = 20; i < daily.length; i++) {
    const window = daily.slice(0, i + 1);
    const today = window[window.length - 1];
    const prev = window[window.length - 2];
    const closes = window.map(c => c.trade_price);
    const ema5 = calculateEMA(closes, 5);
    const ema20 = calculateEMA(closes, 20);
    const rsi = calculateRSI(closes, 14);

    const curEma5 = ema5[ema5.length - 1];
    const prevEma5 = ema5[ema5.length - 2];
    const curEma20 = ema20[ema20.length - 1];
    const prevEma20 = ema20[ema20.length - 2];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex2.getBalance(coinSymbol);
    const krwBal = (await ex2.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 골든크로스: 5선이 20선 상향돌파 & RSI 45~65
    const isCross = prevEma5 <= prevEma20 && curEma5 > curEma20;
    if (!hasCoin && isCross && curRsi >= 45 && curRsi <= 68 && krwBal >= 5000) {
      await ex2.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: today.trade_price,
      } as any, `EMA 5/20 골든크로스 매수`);
    }

    if (hasCoin) {
      const profitRate = (today.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      // 데드크로스 또는 +4% 목표 수익 달성 또는 RSI 72 과열 시
      const isDeadCross = prevEma5 >= prevEma20 && curEma5 < curEma20;
      if (profitRate >= 0.04 || curRsi >= 72 || isDeadCross) {
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: today.trade_price,
        } as any, `청산 (수익률: ${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.03) { // 손절 -3%
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: today.trade_price,
        } as any, `손절 (-3.0%)`);
      }
    }
  }

  // 3. [볼린저 밴드 하단 이탈 역추세 스윙 (60일 일봉 기준)]
  const ex3 = new PaperExchange('볼린저 하단 역발상 스윙', 1000000, coinSymbol);
  for (let i = 20; i < daily.length; i++) {
    const window = daily.slice(0, i + 1);
    const today = window[window.length - 1];
    const prev = window[window.length - 2];
    const closes = window.map(c => c.trade_price);
    const bb = calculateBollingerBands(closes, 20, 2);
    const rsi = calculateRSI(closes, 14);

    const lower = bb.lower[bb.lower.length - 1];
    const mid = bb.middle[bb.middle.length - 1];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex3.getBalance(coinSymbol);
    const krwBal = (await ex3.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 매수: 전일 또는 당일 저가가 볼린저 하단선 이하 터치 & RSI < 42
    if (!hasCoin && (today.low_price <= lower || curRsi <= 40) && krwBal >= 5000) {
      await ex3.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: today.trade_price,
      } as any, `볼린저 하단 터치 & 저가 매수`);
    }

    if (hasCoin) {
      const profitRate = (today.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      // 볼린저 중심선 도달 또는 +3% 수익 시 익절
      if (today.trade_price >= mid || profitRate >= 0.03) {
        await ex3.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: today.trade_price,
        } as any, `중심선 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.03) { // 손절 -3%
        await ex3.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: today.trade_price,
        } as any, `손절 (-3.0%)`);
      }
    }
  }

  const lastPrice = daily[daily.length - 1].trade_price;
  console.table([
    ex1.getSummary(lastPrice),
    ex2.getSummary(lastPrice),
    ex3.getSummary(lastPrice),
  ].map(r => ({
    전략명: r.strategyName,
    초기원금: `${Math.round(r.initialKrw).toLocaleString()}원`,
    최종평가금: `${Math.round(r.portfolioValue).toLocaleString()}원`,
    수익률: `${r.totalProfitRate >= 0 ? '+' : ''}${r.totalProfitRate.toFixed(2)}%`,
    MDD: `${r.maxDrawdown.toFixed(2)}%`,
    총체결: `${r.totalTrades}회`,
    승률: `${r.winRate.toFixed(1)}%`
  })));
}

async function run() {
  await testFull60DaysDaily('KRW-BTC');
  await testFull60DaysDaily('KRW-ETH');
  await testFull60DaysDaily('KRW-SOL');
  await testFull60DaysDaily('KRW-XRP');
}

run().catch(console.error);
