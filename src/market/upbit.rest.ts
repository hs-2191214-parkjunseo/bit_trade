import axios from 'axios';
import { Candle, TickerData } from '../types/market.js';

const UPBIT_API_URL = 'https://api.upbit.com/v1';

export class UpbitRestClient {
  /**
   * 분 단위 캔들 조회 (unit: 1, 3, 5, 15, 30, 60, 240)
   */
  async getMinuteCandles(market: string, unit: 1 | 3 | 5 | 15 | 30 | 60 | 240 = 60, count: number = 200, to?: string): Promise<Candle[]> {
    const url = `${UPBIT_API_URL}/candles/minutes/${unit}`;
    const params: Record<string, any> = { market, count };
    if (to) params.to = to;

    const response = await axios.get<Candle[]>(url, { params });
    // 업비트는 최신순으로 반환하므로 시간순(과거->최신)으로 뒤집어서 리턴
    return response.data.reverse();
  }

  /**
   * 분 단위 캔들 페이지네이션 조회 (대용량 과거 데이터 수집용)
   */
  async getMinuteCandlesMulti(market: string, unit: 1 | 3 | 5 | 15 | 30 | 60 | 240 = 60, totalCount: number = 600): Promise<Candle[]> {
    let allCandles: Candle[] = [];
    let to: string | undefined = undefined;

    while (allCandles.length < totalCount) {
      const count = Math.min(200, totalCount - allCandles.length);
      const url = `${UPBIT_API_URL}/candles/minutes/${unit}`;
      const params: Record<string, any> = { market, count };
      if (to) params.to = to;

      const response = await axios.get<Candle[]>(url, { params });
      const fetched = response.data;
      if (!fetched || fetched.length === 0) break;

      allCandles = allCandles.concat(fetched);
      to = fetched[fetched.length - 1].candle_date_time_utc;

      if (fetched.length < count) break;
      // Rate Limit 보호 (0.1초 딜레이)
      await new Promise((r) => setTimeout(r, 120));
    }

    return allCandles.reverse(); // 과거 -> 최신 정렬
  }

  /**
   * 일 단위 캔들 조회 (09:00 KST 기준)
   */
  async getDailyCandles(market: string, count: number = 200, to?: string): Promise<Candle[]> {
    const url = `${UPBIT_API_URL}/candles/days`;
    const params: Record<string, any> = { market, count };
    if (to) params.to = to;

    const response = await axios.get<Candle[]>(url, { params });
    return response.data.reverse();
  }

  /**
   * 현재가(티커) 조회
   */
  async getCurrentPrice(market: string): Promise<number> {
    const url = `${UPBIT_API_URL}/ticker`;
    const response = await axios.get<TickerData[]>(url, { params: { markets: market } });
    if (!response.data || response.data.length === 0) {
      throw new Error(`Ticker data not found for ${market}`);
    }
    return response.data[0].trade_price;
  }

  /**
   * 티커 상세 정보 조회
   */
  async getTicker(market: string): Promise<TickerData> {
    const url = `${UPBIT_API_URL}/ticker`;
    const response = await axios.get<TickerData[]>(url, { params: { markets: market } });
    return response.data[0];
  }
}

export const upbitClient = new UpbitRestClient();
