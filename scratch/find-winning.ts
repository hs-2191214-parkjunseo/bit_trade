import { upbitClient } from '../src/market/upbit.rest.js';
import { PaperExchange } from '../src/exchange/paper.exchange.js';
import { calculateSMA, calculateEMA } from '../src/indicators/sma.js';
import { calculateRSI } from '../src/indicators/rsi.js';
import { calculateBollingerBands } from '../src/indicators/bollinger.js';

async function findWinningStrategies(market = 'KRW-BTC') {
  const coinSymbol = market.replace('KRW-', '');
  const minutes = await upbitClient.getMinuteCandles(market, 60, 200);
  const daily = await upbitClient.getDailyCandles(market, 60);

  console.log(`\n======================================================`);
  console.log(`🎯 [수익 극대화 전략 탐색] 마켓: ${market}`);
  console.log(`======================================================`);

  // [전략 A] RSI 딥 과매도 + 볼린저 하단 더블 필터 (RSI < 32 & BB Lower 터치)
  // 매수: RSI < 32 또는 BB Lower 하회
  // 매도: RSI >= 55 도달 시 또는 +2.0% 익절 (손절 -2.5%)
  const exA = new PaperExchange('RSI 딥 과매도 반등', 1000000, coinSymbol);
  for (let i = 25; i < minutes.length; i++) {
    const window = minutes.slice(0, i + 1);
    const candle = window[window.length - 1];
    const closes = window.map(c => c.trade_price);
    const rsi = calculateRSI(closes, 14);
    const bb = calculateBollingerBands(closes, 20, 2);

    const curRsi = rsi[rsi.length - 1];
    const curLower = bb.lower[bb.lower.length - 1];
    const curMid = bb.middle[bb.middle.length - 1];

    const coinBal = await exA.getBalance(coinSymbol);
    const krwBal = (await exA.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 매수 조건: 과매도 패닉 셀 구간 (RSI <= 33 또는 저가가 볼린저 하단 터치)
    if (!hasCoin && (curRsi <= 33 || candle.low_price <= curLower) && krwBal >= 5000) {
      await exA.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: candle.trade_price,
      } as any, `RSI 과매도(${curRsi.toFixed(1)}) & BB 하단 터치`);
    }

    if (hasCoin) {
      const avgPrice = coinBal.avg_buy_price;
      const profitRate = (candle.trade_price - avgPrice) / avgPrice;

      // 익절: +1.5% 이상 또는 RSI가 55 중립선 회복 시
      if (profitRate >= 0.018 || (profitRate >= 0.008 && curRsi >= 55)) {
        await exA.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `과매도 반등 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.025) { // 손절 -2.5%
        await exA.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `손절 (-2.5%)`);
      }
    }
  }

  // [전략 B] 스마트 마틴게일 / 그리드 분할 매수 (안전형)
  // 1차: RSI < 40 에서 30% 매수
  // 2차: -1.5% 하락 시 30% 매수
  // 3차: -3.0% 하락 시 40% 매수
  // 익절: 평단가 대비 +1.5% 도달 시 전량 익절
  const exB = new PaperExchange('스마트 그리드 DCA', 1000000, coinSymbol);
  let stepB = 0;
  for (let i = 25; i < minutes.length; i++) {
    const window = minutes.slice(0, i + 1);
    const candle = window[window.length - 1];
    const closes = window.map(c => c.trade_price);
    const rsi = calculateRSI(closes, 14);
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await exB.getBalance(coinSymbol);
    const krwBal = (await exB.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    if (!hasCoin && curRsi <= 38 && krwBal >= 5000) {
      stepB = 1;
      await exB.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.35,
        currentPrice: candle.trade_price,
      } as any, `1차 진입 (RSI: ${curRsi.toFixed(1)})`);
    } else if (hasCoin && stepB === 1 && krwBal >= 5000) {
      const drop = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (drop <= -0.015) {
        stepB = 2;
        await exB.createOrder({
          market,
          side: 'bid',
          ord_type: 'price',
          price: krwBal * 0.5,
          currentPrice: candle.trade_price,
        } as any, `2차 분할 매수 (평단 대비 -1.5%)`);
      }
    } else if (hasCoin && stepB === 2 && krwBal >= 5000) {
      const drop = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (drop <= -0.02) {
        stepB = 3;
        await exB.createOrder({
          market,
          side: 'bid',
          ord_type: 'price',
          price: krwBal * 0.95,
          currentPrice: candle.trade_price,
        } as any, `3차 분할 매수 (평단 대비 -2.0%)`);
      }
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (profitRate >= 0.015) { // +1.5% 익절
        stepB = 0;
        await exB.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate <= -0.04) { // -4% 손절
        stepB = 0;
        await exB.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `최대 손절 (-4.0%)`);
      }
    }
  }

  // [전략 C] 모멘텀 돌파 + 빠른 타이트 익절 (Quick Scalp Momentum)
  // 조건: 5일선 위에 있고, 전일 변동폭 × 0.35 돌파 시 매수 (낮은 K값으로 모멘텀 초입 탑승)
  // 익절: 장중 +1.5% 도달 시 즉시 익절 (다음날까지 안 가져감!)
  // 손절: -1.5%
  const exC = new PaperExchange('모멘텀 스캘핑 돌파', 1000000, coinSymbol);
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
    const target = today.opening_price + prevRange * 0.35; // K=0.35

    const coinBal = await exC.getBalance(coinSymbol);
    const krwBal = (await exC.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 5일선 위이고 당일 고가가 타깃 돌파 시
    if (!hasCoin && !cBought && today.high_price >= target && today.trade_price >= curMa5 && krwBal >= 5000) {
      cBought = true;
      const entryPrice = target;
      await exC.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: entryPrice,
      } as any, `K=0.35 모멘텀 돌파 진입`);

      // 장중 고가로 익절/손절 체크
      const maxPossibleGain = (today.high_price - entryPrice) / entryPrice;
      const minPossibleGain = (today.low_price - entryPrice) / entryPrice;

      const updatedCoin = await exC.getBalance(coinSymbol);
      if (maxPossibleGain >= 0.015) {
        // +1.5% 익절
        await exC.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: updatedCoin.balance,
          currentPrice: entryPrice * 1.015,
        } as any, `장중 +1.5% 목표 달성 익절`);
      } else if (minPossibleGain <= -0.015) {
        // -1.5% 손절
        await exC.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: updatedCoin.balance,
          currentPrice: entryPrice * 0.985,
        } as any, `장중 -1.5% 손절`);
      } else {
        // 당일 종가 청산
        await exC.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: updatedCoin.balance,
          currentPrice: today.trade_price,
        } as any, `당일 종가 마감 청산`);
      }
    }
  }

  const lastPrice = minutes[minutes.length - 1].trade_price;
  const results = [
    exA.getSummary(lastPrice),
    exB.getSummary(lastPrice),
    exC.getSummary(lastPrice),
  ];

  console.table(results.map(r => ({
    전략명: r.strategyName,
    초기원금: `${Math.round(r.initialKrw).toLocaleString()}원`,
    최종평가금: `${Math.round(r.portfolioValue).toLocaleString()}원`,
    수익률: `${r.totalProfitRate >= 0 ? '+' : ''}${r.totalProfitRate.toFixed(2)}%`,
    MDD: `${r.maxDrawdown.toFixed(2)}%`,
    총체결: `${r.totalTrades}회`,
    승률: `${r.winRate.toFixed(1)}%`
  })));
}

async function main() {
  await findWinningStrategies('KRW-BTC');
  await findWinningStrategies('KRW-ETH');
  await findWinningStrategies('KRW-XRP');
  await findWinningStrategies('KRW-SOL');
}

main().catch(console.error);
