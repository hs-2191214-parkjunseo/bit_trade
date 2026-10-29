import { upbitClient } from '../src/market/upbit.rest.js';
import { PaperExchange } from '../src/exchange/paper.exchange.js';
import { calculateSMA, calculateEMA } from '../src/indicators/sma.js';
import { calculateRSI } from '../src/indicators/rsi.js';
import { calculateBollingerBands } from '../src/indicators/bollinger.js';

async function testOptimizedStrategies(market = 'KRW-BTC') {
  console.log(`\n======================================================`);
  console.log(`🔬 [전략 알고리즘 최적화 백테스트] 마켓: ${market}`);
  console.log(`======================================================`);

  const coinSymbol = market.replace('KRW-', '');
  const daily = await upbitClient.getDailyCandles(market, 60);
  const minutes = await upbitClient.getMinuteCandles(market, 60, 200);

  // 1. 개선된 변동성 돌파 (MA5 필터 + 노이즈 K + 트레일링 익절)
  const volEx = new PaperExchange('개선 변동성 돌파', 1000000, coinSymbol);
  let volTarget = 0;
  let volDay = '';
  let volBought = false;
  let highestPriceSinceBuy = 0;

  for (let i = 5; i < daily.length; i++) {
    const window = daily.slice(0, i + 1);
    const today = window[window.length - 1];
    const prev = window[window.length - 2];
    const closes = window.map(c => c.trade_price);
    const ma5 = calculateSMA(closes, 5);
    const currentMa5 = ma5[ma5.length - 1];

    const todayDate = today.candle_date_time_kst.slice(0, 10);
    if (volDay !== todayDate) {
      volDay = todayDate;
      volBought = false;
      highestPriceSinceBuy = 0;
      
      // 노이즈 계산: 1 - |시가 - 종가| / (고가 - 저가)
      const prevRange = prev.high_price - prev.low_price;
      const noise = prevRange > 0 ? 1 - Math.abs(prev.opening_price - prev.trade_price) / prevRange : 0.5;
      const k = Math.max(0.4, Math.min(0.7, noise)); // 0.4 ~ 0.7 사이 동적 K
      volTarget = today.opening_price + prevRange * k;
    }

    const coinBal = await volEx.getBalance(coinSymbol);
    const krwBal = (await volEx.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 장중 고가 기준으로 돌파 여부 확인
    if (!hasCoin && !volBought && today.high_price >= volTarget && today.opening_price >= currentMa5 && krwBal >= 5000) {
      volBought = true;
      const buyPrice = Math.max(today.opening_price, volTarget);
      highestPriceSinceBuy = buyPrice;
      await volEx.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: buyPrice,
      } as any, 'MA5 위 + 노이즈 동적K 목표가 돌파 매수');
    }

    if (hasCoin) {
      highestPriceSinceBuy = Math.max(highestPriceSinceBuy, today.high_price);
      const avgPrice = coinBal.avg_buy_price;
      const maxGain = (highestPriceSinceBuy - avgPrice) / avgPrice;
      const currentGain = (today.trade_price - avgPrice) / avgPrice;

      // 트레일링 익절: 고점 대비 +2% 이상 갔다가 -1% 밀리면 익절
      if (maxGain >= 0.02 && today.trade_price <= highestPriceSinceBuy * 0.99) {
        await volEx.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: today.trade_price,
        } as any, '트레일링 익절 청산');
      } else if (currentGain <= -0.02) { // -2% 타이트 손절
        await volEx.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: today.trade_price,
        } as any, '타이트 손절 청산');
      } else if (i === daily.length - 1 || window[window.length - 1].candle_date_time_kst.slice(0, 10) !== volDay) {
        // 익일 시가/종가 청산
        await volEx.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: today.trade_price,
        } as any, '일봉 마감 청산');
      }
    }
  }

  // 2. 개선된 EMA 추세 + RSI 과매도 반등 (60분봉 기반)
  const emaEx = new PaperExchange('개선 EMA+RSI 반등', 1000000, coinSymbol);
  for (let i = 26; i < minutes.length; i++) {
    const window = minutes.slice(0, i + 1);
    const candle = window[window.length - 1];
    const prevCandle = window[window.length - 2];
    const closes = window.map(c => c.trade_price);
    const emaShort = calculateEMA(closes, 9);
    const emaLong = calculateEMA(closes, 26);
    const rsi = calculateRSI(closes, 14);

    if (emaShort.length < 2 || emaLong.length < 2 || rsi.length < 2) continue;

    const curShort = emaShort[emaShort.length - 1];
    const curLong = emaLong[emaLong.length - 1];
    const curRsi = rsi[rsi.length - 1];
    const prevRsi = rsi[rsi.length - 2];

    const coinBal = await emaEx.getBalance(coinSymbol);
    const krwBal = (await emaEx.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 매수 조건: EMA가 정배열(단기 > 장기)이거나 단기 반등세이면서, RSI가 35~45 과매도권에서 위로 턴어라운드(prevRsi < 40 && curRsi >= 40)
    const isEmaBullish = curShort >= curLong * 0.995; // 정배열 근접
    const isRsiTurnAround = prevRsi < 42 && curRsi >= 42;

    if (!hasCoin && isEmaBullish && isRsiTurnAround && krwBal >= 5000) {
      await emaEx.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.98,
        currentPrice: candle.trade_price,
      } as any, `EMA 정배열 & RSI 반등 (${prevRsi.toFixed(1)} -> ${curRsi.toFixed(1)})`);
    }

    if (hasCoin) {
      const avgPrice = coinBal.avg_buy_price;
      const profitRate = (candle.trade_price - avgPrice) / avgPrice;

      // 익절: +1.8% 달성 시 또는 RSI 70 초과
      if (profitRate >= 0.018 || curRsi >= 70) {
        await emaEx.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 익절 (+${(profitRate * 100).toFixed(2)}% / RSI: ${curRsi.toFixed(1)})`);
      } else if (profitRate <= -0.02) { // 손절: -2%
        await emaEx.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `손절 (-2.0%)`);
      }
    }
  }

  // 3. 개선된 볼린저 밴드 하단 분할 매수 + 중심선 익절 (Mean Reversion)
  const bbEx = new PaperExchange('볼린저 밴드 역추세', 1000000, coinSymbol);
  let bbStep = 0;

  for (let i = 25; i < minutes.length; i++) {
    const window = minutes.slice(0, i + 1);
    const candle = window[window.length - 1];
    const closes = window.map(c => c.trade_price);
    const bb = calculateBollingerBands(closes, 20, 2);
    const rsi = calculateRSI(closes, 14);

    if (bb.lower.length < 1 || rsi.length < 1) continue;

    const lowerBand = bb.lower[bb.lower.length - 1];
    const middleBand = bb.middle[bb.middle.length - 1];
    const upperBand = bb.upper[bb.upper.length - 1];
    const curRsi = rsi[rsi.length - 1];

    const coinBal = await bbEx.getBalance(coinSymbol);
    const krwBal = (await bbEx.getBalance('KRW')).balance;
    const hasCoin = coinBal.balance > 0.000001;

    // 1차 매수: 가격이 볼린저 하단 밴드 이하로 떨어지거나 RSI < 35 과매도
    if (!hasCoin && (candle.low_price <= lowerBand || curRsi <= 35) && krwBal >= 5000) {
      bbStep = 1;
      await bbEx.createOrder({
        market,
        side: 'bid',
        ord_type: 'price',
        price: krwBal * 0.4, // 40% 1차 매수
        currentPrice: candle.trade_price,
      } as any, `볼린저 하단 터치(${Math.round(lowerBand)}) & RSI: ${curRsi.toFixed(1)}`);
    }

    // 2차 매수: 보유 중이고 평단가 대비 -2% 추가 하락 시 잔여 60% 진입
    if (hasCoin && bbStep === 1 && krwBal >= 5000) {
      const avgPrice = coinBal.avg_buy_price;
      const profitRate = (candle.trade_price - avgPrice) / avgPrice;
      if (profitRate <= -0.02) {
        bbStep = 2;
        await bbEx.createOrder({
          market,
          side: 'bid',
          ord_type: 'price',
          price: krwBal * 0.95,
          currentPrice: candle.trade_price,
        } as any, `평단 대비 2% 추가 하락 2차 분할 매수`);
      }
    }

    // 익절/손절
    if (hasCoin) {
      const avgPrice = coinBal.avg_buy_price;
      const profitRate = (candle.trade_price - avgPrice) / avgPrice;

      // 익절: 볼린저 중심선 도달 또는 +1.5% 이상 반등 시
      if (candle.trade_price >= middleBand && profitRate >= 0.01) {
        bbStep = 0;
        await bbEx.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `볼린저 중심선 도달 익절 (+${(profitRate * 100).toFixed(2)}%)`);
      } else if (profitRate >= 0.025) { // +2.5% 상단 익절
        bbStep = 0;
        await bbEx.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `목표 수익률 +2.5% 익절`);
      } else if (profitRate <= -0.04) { // -4% 최종 손절
        bbStep = 0;
        await bbEx.createOrder({
          market,
          side: 'ask',
          ord_type: 'market',
          volume: coinBal.balance,
          currentPrice: candle.trade_price,
        } as any, `손절 (-4.0%)`);
      }
    }
  }

  const lastPrice = minutes[minutes.length - 1].trade_price;
  const results = [
    volEx.getSummary(lastPrice),
    emaEx.getSummary(lastPrice),
    bbEx.getSummary(lastPrice),
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

async function run() {
  await testOptimizedStrategies('KRW-BTC');
  await testOptimizedStrategies('KRW-ETH');
  await testOptimizedStrategies('KRW-XRP');
}

run().catch(console.error);
