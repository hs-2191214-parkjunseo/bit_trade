export interface Balance {
  currency: string;
  balance: number;
  locked: number;
  avg_buy_price: number;
}

export type OrderSide = 'bid' | 'ask'; // bid: 매수, ask: 매도
export type OrderType = 'limit' | 'price' | 'market'; // price: 시장가 매수(금액 지정), market: 시장가 매도(수량 지정)

export interface OrderRequest {
  market: string;
  side: OrderSide;
  volume?: number; // 매도 수량 또는 지정가 수량
  price?: number;  // 시장가 매수 금액 또는 지정가 가격
  ord_type: OrderType;
}

export interface OrderResult {
  uuid: string;
  side: OrderSide;
  ord_type: OrderType;
  price: number;
  market: string;
  created_at: string;
  volume: number;
  executed_volume: number;
  paid_fee: number;
  state: 'wait' | 'done' | 'cancel';
}

export interface TradeRecord {
  id: string;
  timestamp: number;
  datetime: string;
  strategyName: string;
  market: string;
  side: OrderSide;
  price: number;
  volume: number;
  fee: number;
  totalKrw: number;
  reason?: string;
  profitKrw?: number;
  profitRate?: number;
}
