import { upbitClient } from '../market/upbit.rest.js';
import { PaperExchange } from '../exchange/paper.exchange.js';
import { VolatilityBreakoutStrategy } from '../strategies/volatility-breakout.strategy.js';
import { GoldenCrossRsiStrategy } from '../strategies/golden-cross-rsi.strategy.js';
import { SmartDcaStrategy } from '../strategies/smart-dca.strategy.js';
import { StrategyContext } from '../types/strategy.js';

export async function executeBacktest(market: string = 'KRW-BTC', days: number = 60) {
  const coinSymbol = market.replace('KRW-', '');
  const initialKrw = 1000000;

  const dailyCandles = await upbitClient.getDailyCandles(market, Math.min(days, 200));
  const minuteCandles = await upbitClient.getMinuteCandles(market, 60, 200);

  // 1. 변동성 돌파
  const volExchange = new PaperExchange('변동성 돌파', initialKrw, coinSymbol);
  const volStrategy = new VolatilityBreakoutStrategy(0.5, 0.03);

  for (let i = 2; i < dailyCandles.length; i++) {
    const windowCandles = dailyCandles.slice(0, i + 1);
    const candle = windowCandles[windowCandles.length - 1];
    const coinBal = await volExchange.getBalance(coinSymbol);
    const krwBal = (await volExchange.getBalance('KRW')).balance;

    const ctx: StrategyContext = {
      market,
      currentPrice: candle.trade_price,
      krwBalance: krwBal,
      coinBalance: coinBal,
      candles: windowCandles,
    };

    const signal = await volStrategy.evaluate(ctx);
    if (signal.action === 'BUY' && signal.amountKrw) {
      await volExchange.createOrder(
        { market, side: 'bid', ord_type: 'price', price: signal.amountKrw, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    } else if (signal.action === 'SELL' && signal.volume) {
      await volExchange.createOrder(
        { market, side: 'ask', ord_type: 'market', volume: signal.volume, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    }
  }

  // 2. 골든크로스 + RSI
  const maExchange = new PaperExchange('골든크로스+RSI', initialKrw, coinSymbol);
  const maStrategy = new GoldenCrossRsiStrategy(7, 20, 14, 0.035);

  for (let i = 25; i < minuteCandles.length; i++) {
    const windowCandles = minuteCandles.slice(0, i + 1);
    const candle = windowCandles[windowCandles.length - 1];
    const coinBal = await maExchange.getBalance(coinSymbol);
    const krwBal = (await maExchange.getBalance('KRW')).balance;

    const ctx: StrategyContext = {
      market,
      currentPrice: candle.trade_price,
      krwBalance: krwBal,
      coinBalance: coinBal,
      candles: windowCandles,
    };

    const signal = await maStrategy.evaluate(ctx);
    if (signal.action === 'BUY' && signal.amountKrw) {
      await maExchange.createOrder(
        { market, side: 'bid', ord_type: 'price', price: signal.amountKrw, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    } else if (signal.action === 'SELL' && signal.volume) {
      await maExchange.createOrder(
        { market, side: 'ask', ord_type: 'market', volume: signal.volume, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    }
  }

  // 3. 스마트 분할매수
  const dcaExchange = new PaperExchange('스마트 분할매수', initialKrw, coinSymbol);
  const dcaStrategy = new SmartDcaStrategy();

  for (let i = 20; i < minuteCandles.length; i++) {
    const windowCandles = minuteCandles.slice(0, i + 1);
    const candle = windowCandles[windowCandles.length - 1];
    const coinBal = await dcaExchange.getBalance(coinSymbol);
    const krwBal = (await dcaExchange.getBalance('KRW')).balance;

    const ctx: StrategyContext = {
      market,
      currentPrice: candle.trade_price,
      krwBalance: krwBal,
      coinBalance: coinBal,
      candles: windowCandles,
    };

    const signal = await dcaStrategy.evaluate(ctx);
    if (signal.action === 'BUY' && signal.amountKrw) {
      await dcaExchange.createOrder(
        { market, side: 'bid', ord_type: 'price', price: signal.amountKrw, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    } else if (signal.action === 'SELL' && signal.volume) {
      await dcaExchange.createOrder(
        { market, side: 'ask', ord_type: 'market', volume: signal.volume, currentPrice: candle.trade_price } as any,
        signal.reason
      );
    }
  }

  const lastPrice = minuteCandles[minuteCandles.length - 1].trade_price;
  return [
    volExchange.getSummary(lastPrice),
    maExchange.getSummary(lastPrice),
    dcaExchange.getSummary(lastPrice),
  ];
}
