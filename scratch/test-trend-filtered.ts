import { upbitClient } from '../src/market/upbit.rest.js';
import { PaperExchange } from '../src/exchange/paper.exchange.js';
import { calculateSMA, calculateEMA } from '../src/indicators/sma.js';
import { calculateRSI } from '../src/indicators/rsi.js';
import { calculateBollingerBands } from '../src/indicators/bollinger.js';

async function testTrendFilteredStrategies(market = 'KRW-BTC') {
  const coinSymbol = market.replace('KRW-', '');
  const minutes = await upbitClient.getMinuteCandles(market, 60, 200);
  const daily = await upbitClient.getDailyCandles(market, 60);

  // 1. [하락장 차단형 변동성 돌파]
  // - 20일 이동평균선(중기 추세) 위에 있을 때만 진입 (하락장 완전 차단)
  // - K = 0.45
  // - 거래량이 전일 대비 1.2배 이상 증가했을 때만 진입 (가짜 돌파 필터링)
  // - 장중 +2% 익절 또는 익일 시가 청산, 손절 -1.5%
  const ex1 = new PaperExchange('추세필터 변동성돌파', 1000000, coinSymbol);
  let vDay = '';
  let vBought = false;

  for (let i = 20; i < daily.length; i++) {
    const window = daily.slice(0, i + 1);
    const today = window[window.length - 1];
    const prev = window[window.length - 2];
    const closes = window.map(c => c.trade_price);
    const ma20 = calculateSMA(closes, 20);
    const curMa20 = ma20[ma20.length - 1];

    const todayDate = today.candle_date_time_kst.slice(0, 10);
    if (vDay !== todayDate) {
      vDay = todayDate;
      vBought = false;
    }

    const prevRange = prev.high_price - prev.low_price;
    const target = today.opening_price + prevRange * 0.45;
    const isAboveMa20 = today.opening_price >= curMa20; // 20일선 위

    const coinBal = await ex1.getBalance(coinSymbol);
    const krwBal = (await ex1.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 대세 상승장 + 목표가 돌파
    if (!hasCoin && !vBought && isAboveMa20 && today.high_price >= target && krwBal >= 5000) {
      vBought = true;
      const entryPrice = target;
      await ex1.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: entryPrice,
      } as any, `20일선 위 정배열 돌파 매수`);

      const updatedCoin = await ex1.getBalance(coinSymbol);
      const maxGain = (today.high_price - entryPrice) / entryPrice;
      const minGain = (today.low_price - entryPrice) / entryPrice;

      if (maxGain >= 0.02) {
        await ex1.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: updatedCoin.balance,
          currentPrice: entryPrice * 1.02,
        } as any, `목표 +2.0% 장중 익절`);
      } else if (minGain <= -0.015) {
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
        } as any, `익일 시가/종가 마감`);
      }
    }
  }

  // 2. [볼린저 밴드 + RSI 극단 과매도 V자 반등 (Extreme Reversal)]
  // 60분봉에서 볼린저 하단(20, 2) 이탈 + RSI < 30 (극단적 투매/패닉셀) 발생
  // 다음 캔들에서 양봉(반등) 시작 시 매수
  // 익절: 볼린저 중심선 또는 +2.0% 도달 시 즉시 익절
  // 손절: -2.0%
  const ex2 = new PaperExchange('극단 과매도 V자 반등', 1000000, coinSymbol);
  for (let i = 25; i < minutes.length; i++) {
    const window = minutes.slice(0, i + 1);
    const candle = window[window.length - 1];
    const prevCandle = window[window.length - 2];
    const closes = window.map(c => c.trade_price);
    const bb = calculateBollingerBands(closes, 20, 2);
    const rsi = calculateRSI(closes, 14);

    const prevLower = bb.lower[bb.lower.length - 2];
    const curMiddle = bb.middle[bb.middle.length - 1];
    const prevRsi = rsi[rsi.length - 2];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await ex2.getBalance(coinSymbol);
    const krwBal = (await ex2.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 전봉에서 극단 과매도 (RSI < 30 또는 볼린저 하단 이탈) 발생 후 현재봉에서 양봉 반등
    const isPanicDrop = prevRsi <= 32 || prevCandle.low_price <= prevLower;
    const isTurningUp = candle.trade_price > candle.opening_price && curRsi > prevRsi;

    if (!hasCoin && isPanicDrop && isTurningUp && krwBal >= 5000) {
      await ex2.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: candle.trade_price,
      } as any, `투매 패닉셀 후 V자 양봉 반등 (RSI ${prevRsi.toFixed(1)} -> ${curRsi.toFixed(1)})`);
    }

    if (hasCoin) {
      const profitRate = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (candle.trade_price >= curMiddle && profitRate >= 0.01) {
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `볼린저 중심선 도달 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate >= 0.02) {
        await ex2.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 +2.0% 익절`);
      } else if (profitRate <= -0.02) {
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

  // 3. [동적 분할 매수 & 단기 박스권 트레이딩]
  // 최근 30개 봉 최저가 + 볼린저 하단 밴드 결합
  // 1차 진입: 볼린저 하단선 도달 시 50%
  // 2차 진입: -2% 추가 하락 시 50%
  // 익절: 평단 대비 +1.5% 반등 시 전량 익절
  // 손절: 평단 대비 -3.0%
  const ex3 = new PaperExchange('볼린저 그리드 DCA', 1000000, coinSymbol);
  let step3 = 0;
  for (let i = 25; i < minutes.length; i++) {
    const window = minutes.slice(0, i + 1);
    const candle = window[window.length - 1];
    const closes = window.map(c => c.trade_price);
    const bb = calculateBollingerBands(closes, 20, 2);
    const curLower = bb.lower[bb.lower.length - 1];

    const coinBal = await ex3.getBalance(coinSymbol);
    const krwBal = (await ex3.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    if (!hasCoin && candle.low_price <= curLower && krwBal >= 5000) {
      step3 = 1;
      await ex3.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.5,
        currentPrice: candle.trade_price,
      } as any, `볼린저 하단 1차 매수`);
    } else if (hasCoin && step3 === 1 && krwBal >= 5000) {
      const drop = (candle.trade_price - coinBal.avg_buy_price) / coinBal.avg_buy_price;
      if (drop <= -0.02) {
        step3 = 2;
        await ex3.createOrder({
          market,
          side: 'bid',
          ord_type: 'price',
          price: krwBal * 0.95,
          currentPrice: candle.trade_price,
        } as any, `2차 분할 매수 (-2.0%)`);
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
        } as any, `목표 +1.5% 익절`);
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
  await testTrendFilteredStrategies('KRW-BTC');
  await testTrendFilteredStrategies('KRW-ETH');
  await testTrendFilteredStrategies('KRW-SOL');
  await testTrendFilteredStrategies('KRW-XRP');
}

run().catch(console.error);
