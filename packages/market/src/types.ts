import { AssetType } from '@stock-market/shared';

export interface MarketQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  timestamp: number;
}

export interface CompanyProfile {
  ticker: string;
  name: string;
  logo: string;
  description: string;
  sector: string;
  industry: string;
  ceo: string;
  employees: number;
  marketCap: number;
  peRatio: number;
  eps: number;
  dividendYield: number;
  beta: number;
  high52Week: number;
  low52Week: number;
  currency: string;
  exchange: string;
  country?: string;
  assetType?: string;
}

export interface MarketHistoryBar {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketSessionInfo {
  isOpen: boolean;
  sessionType: 'REGULAR' | 'PRE_MARKET' | 'POST_MARKET' | 'CLOSED';
  nextOpen: Date;
  nextClose: Date;
  timezone: string;
}
