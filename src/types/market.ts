export interface Candle {
  market: string;
  candle_date_time_utc: string;
  candle_date_time_kst: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number; // 종가
  timestamp: number;
  candle_acc_trade_price: number;
  candle_acc_trade_volume: number;
}

export interface TickerData {
  market: string;
  trade_price: number;
  opening_price: number;
  high_price: number;
  low_price: number;
  prev_closing_price: number;
  change: 'RISE' | 'EVEN' | 'FALL';
  change_price: number;
  change_rate: number;
  acc_trade_volume_24h: number;
  timestamp: number;
}
