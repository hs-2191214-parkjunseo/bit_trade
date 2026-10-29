export interface MarketInfo {
  id: string;
  symbol: string;
  name: string;
  category: 'Major' | 'Layer1' | 'DeFi' | 'Meme';
}

export const SUPPORTED_MARKETS: MarketInfo[] = [
  { id: 'KRW-BTC', symbol: 'BTC', name: '비트코인', category: 'Major' },
  { id: 'KRW-ETH', symbol: 'ETH', name: '이더리움', category: 'Major' },
  { id: 'KRW-XRP', symbol: 'XRP', name: '리플', category: 'Major' },
  { id: 'KRW-SOL', symbol: 'SOL', name: '솔라나', category: 'Layer1' },
  { id: 'KRW-DOGE', symbol: 'DOGE', name: '도지코인', category: 'Meme' },
  { id: 'KRW-ADA', symbol: 'ADA', name: '에이다', category: 'Layer1' },
  { id: 'KRW-AVAX', symbol: 'AVAX', name: '아발란체', category: 'Layer1' },
  { id: 'KRW-DOT', symbol: 'DOT', name: '폴카닷', category: 'Layer1' },
  { id: 'KRW-LINK', symbol: 'LINK', name: '체인링크', category: 'DeFi' },
  { id: 'KRW-NEAR', symbol: 'NEAR', name: '니어프로토콜', category: 'Layer1' },
  { id: 'KRW-SUI', symbol: 'SUI', name: '수이', category: 'Layer1' },
  { id: 'KRW-SEI', symbol: 'SEI', name: '세이', category: 'Layer1' },
  { id: 'KRW-APT', symbol: 'APT', name: '앱토스', category: 'Layer1' },
  { id: 'KRW-SHIB', symbol: 'SHIB', name: '시바이누', category: 'Meme' },
  { id: 'KRW-ETC', symbol: 'ETC', name: '이더리움클래식', category: 'Layer1' },
];
