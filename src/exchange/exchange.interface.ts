import { Balance, OrderRequest, OrderResult, TradeRecord } from '../types/exchange.js';

export interface IExchange {
  name: string;
  isPaper: boolean;
  getBalances(): Promise<Balance[]>;
  getBalance(currency: string): Promise<Balance>;
  createOrder(request: OrderRequest, reason?: string): Promise<OrderResult>;
  getTrades(): TradeRecord[];
  getPortfolioValue(currentPrice: number): number;
}
