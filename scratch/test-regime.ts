import { upbitClient } from '../src/market/upbit.rest.js';
import { PaperExchange } from '../src/exchange/paper.exchange.js';
import { calculateSMA, calculateEMA } from '../src/indicators/sma.js';
import { calculateRSI } from '../src/indicators/rsi.js';
import { calculateBollingerBands } from '../src/indicators/bollinger.js';

async function testSmartRegimeBot(market = 'KRW-BTC') {
  const coinSymbol = market.replace('KRW-', '');
  const candles = await upbitClient.getMinuteCandlesMulti(market, 60, 1000);
  const closes = candles.map(c => c.trade_price);
  const buyAndHold = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;

  console.log(`\n======================================================`);
  console.log(`🛡️ [하락장 방어 + 반등 알파 퀀트 봇] ${market}`);
  console.log(`시장 수익률(Buy&Hold): ${buyAndHold >= 0 ? '+' : ''}${buyAndHold.toFixed(2)}%`);
  console.log(`======================================================`);

  // [전략 1] 스마트 추세 돌파 (200선 위 상승장에서만 돌파 진입)
  const ex1 = new PaperExchange('스마트 추세돌파', 1000000, coinSymbol);
  for (let i = 100; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const candle = window[window.length - 1];
    const prevCandle = window[window.length - 2];
    const wCloses = window.map(c => c.trade_price);

    const ema100 = calculateEMA(wCloses, 100);
    const ema20 = calculateEMA(wCloses, 20);
    const rsi = calculateRSI(wCloses, 14);

    const cur100 = ema100[ema100.length - 1];
    const cur20 = ema20[ema20.length - 1];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex1.getBalance(coinSymbol);
    const krwBal = (await ex1.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 대세 상승장(100 EMA 위) + 20 EMA 위 돌파 + RSI 52~65
    const isBullMarket = candle.trade_price > cur100 && candle.trade_price > cur20;
    const isBreakout = prevCandle.trade_price <= cur20 && candle.trade_price > cur20 && curRsi >= 52 && curRsi <= 65;

    if (!hasCoin && isBullMarket && isBreakout && krwBal >= 5000) {
      await ex1.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: candle.trade_price,
      } as any, `대세 상승장 20선 돌파`);
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (profitRate >= 0.02 || curRsi >= 72) { // +2.0% 익절
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.015 || candle.trade_price < cur20) { // -1.5% 손절
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `손절/이탈 (-${((Math.abs(profitRate))*100).toFixed(2)}%)`);
      }
    }
  }

  // [전략 2] 극단 투매(RSI < 28) V자 반등 스캘핑 (Oversold Sniper)
  // 대세 하락장에서도 유일하게 통하는 '패닉셀 역발상 스캘핑'
  // 조건: RSI가 28 이하로 공포 투매가 나왔다가 양봉으로 첫 반등하는 순간
  // 익절: +1.2% ~ +1.5%만 먹고 즉시 현금화 (욕심 안 부림)
  // 손절: -1.5%
  const ex2 = new PaperExchange('극단 투매 스나이퍼', 1000000, coinSymbol);
  for (let i = 25; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const candle = window[window.length - 1];
    const prevCandle = window[window.length - 2];
    const wCloses = window.map(c => c.trade_price);
    const rsi = calculateRSI(wCloses, 14);

    const prevRsi = rsi[rsi.length - 2];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex2.getBalance(coinSymbol);
    const krwBal = (await ex2.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 패닉셀 조건: 전봉에서 RSI <= 28 터치 후, 현재봉에서 양봉(종가 > 시가)으로 턴어라운드
    const wasPanic = prevRsi <= 28;
    const isReversal = candle.trade_price > candle.opening_price && curRsi > prevRsi;

    if (!hasCoin && wasPanic && isReversal && krwBal >= 5000) {
      await ex2.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: candle.trade_price,
      } as any, `RSI 극단 과매도(${prevRsi.toFixed(1)}) 양봉 반등`);
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (profitRate >= 0.014 || curRsi >= 50) { // +1.4% 익절 또는 RSI 중립 회복
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `과매도 반등 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.015) { // -1.5% 손절
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

  // [전략 3] 볼린저 하단 밴드 워크 반등 DCA (Lower Band Rebound DCA)
  const ex3 = new PaperExchange('볼린저 하단 반등 DCA', 1000000, coinSymbol);
  let step3 = 0;
  for (let i = 25; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);
    const candle = window[window.length - 1];
    const prevCandle = window[window.length - 2];
    const wCloses = window.map(c => c.trade_price);
    const bb = calculateBollingerBands(wCloses, 20, 2);
    const rsi = calculateRSI(wCloses, 14);

    const prevLower = bb.lower[bb.lower.length - 2];
    const curLower = bb.lower[bb.lower.length - 1];
    const curMid = bb.middle[bb.middle.length - 1];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex3.getBalance(coinSymbol);
    const krwBal = (await ex3.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 볼린저 하단선 이탈 후 양봉 전환 시 1차(50%)
    const isLowerRebound = prevCandle.low_price <= prevLower && candle.trade_price > candle.opening_price && curRsi <= 38;
    if (!hasCoin && isLowerRebound && krwBal >= 5000) {
      step3 = 1;
      await ex3.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.5,
        currentPrice: candle.trade_price,
      } as any, `볼린저 하단선 이탈 후 양봉 1차 매수`);
    } else if (hasCoin && step3 === 1 && krwBal >= 5000) {
      const drop = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (drop <= -0.018) { // -1.8% 추가 하락 시 2차 매수
        step3 = 2;
        await ex3.createOrder({
          market,
          side: 'bid',
          ord_type: 'price',
          price: krwBal * 0.95,
          currentPrice: candle.trade_price,
        } as any, `1.8% 하락 2차 분할 매수`);
      }
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (candle.trade_price >= curMid || profitRate >= 0.015) { // 볼린저 중심선 또는 +1.5% 익절
        step3 = 0;
        await ex3.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `중심선 익절 (+${(profitRate * 100).toFixed(2)}%)`);
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
  await testSmartRegimeBot('KRW-BTC');
  await testSmartRegimeBot('KRW-ETH');
  await testSmartRegimeBot('KRW-SOL');
  await testSmartRegimeBot('KRW-XRP');
}

run().catch(console.error);
