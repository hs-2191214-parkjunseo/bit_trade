import { Balance, OrderRequest, OrderResult, TradeRecord } from '../types/exchange.js';
import { IExchange } from './exchange.interface.js';
import { v4 as uuidv4 } from 'uuid';

export class PaperExchange implements IExchange {
  name: string;
  isPaper: boolean = true;
  initialKrw: number;
  krw: number;
  coinBalance: number = 0;
  coinCurrency: string;
  avgBuyPrice: number = 0;
  feeRate: number = 0.0005; // 업비트 0.05%
  trades: TradeRecord[] = [];
  peakValue: number;
  maxDrawdown: number = 0;

  constructor(name: string, initialKrw: number = 1000000, coinCurrency: string = 'BTC') {
    this.name = name;
    this.initialKrw = initialKrw;
    this.krw = initialKrw;
    this.coinCurrency = coinCurrency;
    this.peakValue = initialKrw;
  }

  async getBalances(): Promise<Balance[]> {
    return [
      { currency: 'KRW', balance: this.krw, locked: 0, avg_buy_price: 0 },
      { currency: this.coinCurrency, balance: this.coinBalance, locked: 0, avg_buy_price: this.avgBuyPrice },
    ];
  }

  async getBalance(currency: string): Promise<Balance> {
    if (currency === 'KRW') {
      return { currency: 'KRW', balance: this.krw, locked: 0, avg_buy_price: 0 };
    }
    if (currency === this.coinCurrency) {
      return { currency: this.coinCurrency, balance: this.coinBalance, locked: 0, avg_buy_price: this.avgBuyPrice };
    }
    return { currency, balance: 0, locked: 0, avg_buy_price: 0 };
  }

  /**
   * 가상 주문 체결
   */
  async createOrder(request: OrderRequest, reason: string = ''): Promise<OrderResult> {
    const { side, ord_type, price, volume, market } = request;
    const now = new Date();
    const uuid = uuidv4();

    if (side === 'bid') {
      // 매수: ord_type === 'price' (시장가 매수: price가 매수할 KRW 금액)
      const buyKrw = price || 0;
      if (buyKrw <= 0 || this.krw < buyKrw) {
        throw new Error(`[${this.name}] 잔액 부족 (보유: ${Math.floor(this.krw)} KRW, 주문: ${buyKrw} KRW)`);
      }

      // 실제 체결 단가 엄격 검증 (단가 누락 시 오류 방어)
      const estimatedPrice = (request as any).currentPrice;
      if (!estimatedPrice || estimatedPrice <= 0) {
        throw new Error(`[${this.name}] 체결 단가(currentPrice) 누락 또는 비정상: ${estimatedPrice}`);
      }
      const fee = buyKrw * this.feeRate;
      const netBuyKrw = buyKrw - fee;
      const executedVolume = netBuyKrw / estimatedPrice;

      // 평균 매수가 계산
      const totalCost = this.avgBuyPrice * this.coinBalance + netBuyKrw;
      this.coinBalance += executedVolume;
      this.avgBuyPrice = this.coinBalance > 0 ? totalCost / this.coinBalance : 0;
      this.krw -= buyKrw;

      const record: TradeRecord = {
        id: uuid,
        timestamp: now.getTime(),
        datetime: now.toISOString(),
        strategyName: this.name,
        market,
        side: 'bid',
        price: estimatedPrice,
        volume: executedVolume,
        fee,
        totalKrw: buyKrw,
        reason,
      };
      this.trades.unshift(record);

      return {
        uuid,
        side: 'bid',
        ord_type,
        price: estimatedPrice,
        market,
        created_at: now.toISOString(),
        volume: executedVolume,
        executed_volume: executedVolume,
        paid_fee: fee,
        state: 'done',
      };
    } else {
      // 매도: ord_type === 'market' (시장가 매도: volume이 매도 수량)
      const sellVolume = volume || 0;
      if (sellVolume <= 0 || this.coinBalance < sellVolume) {
        throw new Error(`[${this.name}] 코인 잔액 부족 (보유: ${this.coinBalance}, 주문: ${sellVolume})`);
      }

      const estimatedPrice = (request as any).currentPrice || (ord_type === 'limit' ? price : 0);
      if (!estimatedPrice || estimatedPrice <= 0) {
        throw new Error(`[${this.name}] 매도 체결 단가(currentPrice) 누락 또는 비정상: ${estimatedPrice}`);
      }
      const grossKrw = sellVolume * estimatedPrice;
      const fee = grossKrw * this.feeRate;
      const netKrw = grossKrw - fee;

      // 손익 계산
      const buyCost = sellVolume * this.avgBuyPrice;
      const profitKrw = netKrw - buyCost;
      const profitRate = buyCost > 0 ? (profitKrw / buyCost) * 100 : 0;

      this.coinBalance -= sellVolume;
      if (this.coinBalance <= 0.0000001) {
        this.coinBalance = 0;
        this.avgBuyPrice = 0;
      }
      this.krw += netKrw;

      const record: TradeRecord = {
        id: uuid,
        timestamp: now.getTime(),
        datetime: now.toISOString(),
        strategyName: this.name,
        market,
        side: 'ask',
        price: estimatedPrice,
        volume: sellVolume,
        fee,
        totalKrw: netKrw,
        reason,
        profitKrw,
        profitRate,
      };
      this.trades.unshift(record);

      return {
        uuid,
        side: 'ask',
        ord_type,
        price: estimatedPrice,
        market,
        created_at: now.toISOString(),
        volume: sellVolume,
        executed_volume: sellVolume,
        paid_fee: fee,
        state: 'done',
      };
    }
  }

  getTrades(): TradeRecord[] {
    return this.trades;
  }

  getPortfolioValue(currentPrice: number): number {
    const total = this.krw + this.coinBalance * currentPrice;
    if (total > this.peakValue) {
      this.peakValue = total;
    }
    const currentDrawdown = ((this.peakValue - total) / this.peakValue) * 100;
    if (currentDrawdown > this.maxDrawdown) {
      this.maxDrawdown = currentDrawdown;
    }
    return total;
  }

  getSummary(currentPrice: number) {
    const portfolioValue = this.getPortfolioValue(currentPrice);
    const totalProfitKrw = portfolioValue - this.initialKrw;
    const totalProfitRate = ((portfolioValue - this.initialKrw) / this.initialKrw) * 100;

    const sellTrades = this.trades.filter((t) => t.side === 'ask' && t.profitKrw !== undefined);
    const winTrades = sellTrades.filter((t) => (t.profitKrw || 0) > 0);
    const winRate = sellTrades.length > 0 ? (winTrades.length / sellTrades.length) * 100 : 0;

    return {
      strategyName: this.name,
      initialKrw: this.initialKrw,
      currentKrw: this.krw,
      coinBalance: this.coinBalance,
      avgBuyPrice: this.avgBuyPrice,
      currentPrice,
      portfolioValue,
      totalProfitKrw,
      totalProfitRate,
      maxDrawdown: this.maxDrawdown,
      totalTrades: this.trades.length,
      sellTrades: sellTrades.length,
      winRate,
      trades: this.trades.slice(0, 20), // 최근 20개
    };
  }
}
