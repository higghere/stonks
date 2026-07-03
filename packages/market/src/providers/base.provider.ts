import { MarketQuote, CompanyProfile, MarketHistoryBar } from '../types';

export abstract class MarketProvider {
  abstract getName(): string;
  abstract getQuote(ticker: string): Promise<MarketQuote>;
  abstract getCompanyProfile(ticker: string): Promise<CompanyProfile>;
  abstract getHistory(
    ticker: string,
    resolution: string, // "1m" | "5m" | "1d" etc.
    from: number,
    to: number
  ): Promise<MarketHistoryBar[]>;
  abstract searchTickers(
    query: string
  ): Promise<Array<{ ticker: string; name: string; exchange: string; assetType: string }>>;
}
