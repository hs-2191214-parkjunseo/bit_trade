import axios from 'axios';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import querystring from 'querystring';
import { Balance, OrderRequest, OrderResult, TradeRecord } from '../types/exchange.js';
import { IExchange } from './exchange.interface.js';

export class UpbitRealExchange implements IExchange {
  name: string = 'Upbit Real';
  isPaper: boolean = false;
  private accessKey: string;
  private secretKey: string;
  private apiUrl: string = 'https://api.upbit.com/v1';
  private trades: TradeRecord[] = [];

  constructor(accessKey?: string, secretKey?: string) {
    this.accessKey = accessKey || process.env.UPBIT_ACCESS_KEY || '';
    this.secretKey = secretKey || process.env.UPBIT_SECRET_KEY || '';

    if (!this.accessKey || !this.secretKey) {
      console.warn('[UpbitRealExchange] API Key가 설정되지 않았습니다. 실거래 주문 시 에러가 발생합니다.');
    }
  }

  private getAuthHeader(queryParams?: Record<string, any>): string {
    const payload: any = {
      access_key: this.accessKey,
      nonce: uuidv4(),
    };

    if (queryParams && Object.keys(queryParams).length > 0) {
      const query = querystring.encode(queryParams);
      const hash = crypto.createHash('sha512');
      const queryHash = hash.update(query, 'utf-8').digest('hex');
      payload.query_hash = queryHash;
      payload.query_hash_alg = 'SHA512';
    }

    const token = jwt.sign(payload, this.secretKey);
    return `Bearer ${token}`;
  }

  async getBalances(): Promise<Balance[]> {
    const url = `${this.apiUrl}/accounts`;
    const res = await axios.get(url, {
      headers: { Authorization: this.getAuthHeader() },
    });
    return res.data.map((item: any) => ({
      currency: item.currency,
      balance: parseFloat(item.balance),
      locked: parseFloat(item.locked),
      avg_buy_price: parseFloat(item.avg_buy_price),
    }));
  }

  async getBalance(currency: string): Promise<Balance> {
    const balances = await this.getBalances();
    const target = balances.find((b) => b.currency === currency);
    return target || { currency, balance: 0, locked: 0, avg_buy_price: 0 };
  }

  async createOrder(request: OrderRequest, reason: string = ''): Promise<OrderResult> {
    const body: Record<string, any> = {
      market: request.market,
      side: request.side,
      ord_type: request.ord_type,
    };
    if (request.volume) body.volume = request.volume.toString();
    if (request.price) body.price = request.price.toString();

    const url = `${this.apiUrl}/orders`;
    const res = await axios.post(url, body, {
      headers: { Authorization: this.getAuthHeader(body) },
    });

    const data = res.data;
    const record: TradeRecord = {
      id: data.uuid,
      timestamp: Date.now(),
      datetime: new Date().toISOString(),
      strategyName: this.name,
      market: request.market,
      side: request.side,
      price: parseFloat(data.price || '0'),
      volume: parseFloat(data.volume || '0'),
      fee: parseFloat(data.paid_fee || '0'),
      totalKrw: parseFloat(data.price || '0') * parseFloat(data.volume || '0'),
      reason,
    };
    this.trades.unshift(record);

    return {
      uuid: data.uuid,
      side: data.side,
      ord_type: data.ord_type,
      price: parseFloat(data.price || '0'),
      market: data.market,
      created_at: data.created_at,
      volume: parseFloat(data.volume || '0'),
      executed_volume: parseFloat(data.executed_volume || '0'),
      paid_fee: parseFloat(data.paid_fee || '0'),
      state: data.state,
    };
  }

  getTrades(): TradeRecord[] {
    return this.trades;
  }

  getPortfolioValue(_currentPrice: number): number {
    return 0; // 실계좌는 API 잔고 조회로 대체
  }
}
