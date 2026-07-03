import { MarketProvider } from './base.provider';
import { MarketQuote, CompanyProfile, MarketHistoryBar } from '../types';
import { prisma } from '@stock-market/database';

interface BaselineTicker {
  name: string;
  price: number;
  sector: string;
  industry: string;
  description: string;
  currency: string;
  exchange: string;
}

const BASELINES: Record<string, BaselineTicker> = {
  AAPL: { name: 'Apple Inc.', price: 185.50, sector: 'Technology', industry: 'Consumer Electronics', description: 'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide.', currency: 'USD', exchange: 'NASDAQ' },
  MSFT: { name: 'Microsoft Corp.', price: 415.20, sector: 'Technology', industry: 'Software—Infrastructure', description: 'Microsoft Corporation develops and supports software, services, devices, and solutions worldwide.', currency: 'USD', exchange: 'NASDAQ' },
  GOOGL: { name: 'Alphabet Inc.', price: 172.80, sector: 'Technology', industry: 'Internet Content & Information', description: 'Alphabet Inc. offers Google Search, YouTube, Google Cloud, and other internet services globally.', currency: 'USD', exchange: 'NASDAQ' },
  AMZN: { name: 'Amazon.com Inc.', price: 180.40, sector: 'Consumer Cyclical', industry: 'Internet Retail', description: 'Amazon.com, Inc. engages in the retail sale of consumer products and subscriptions in North America and internationally.', currency: 'USD', exchange: 'NASDAQ' },
  TSLA: { name: 'Tesla Inc.', price: 175.20, sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', description: 'Tesla, Inc. designs, develops, manufactures, leases, and sells electric vehicles, and energy generation and storage systems.', currency: 'USD', exchange: 'NASDAQ' },
  NVDA: { name: 'NVIDIA Corp.', price: 880.10, sector: 'Technology', industry: 'Semiconductors', description: 'NVIDIA Corporation provides graphics, and compute and networking solutions worldwide.', currency: 'USD', exchange: 'NASDAQ' },
  JPM: { name: 'JPMorgan Chase & Co.', price: 195.60, sector: 'Financial Services', industry: 'Banks—Diversified', description: 'JPMorgan Chase & Co. operates as a financial services company worldwide.', currency: 'USD', exchange: 'NYSE' },
  BARC: { name: 'Barclays PLC', price: 190.50, sector: 'Financial Services', industry: 'Banks—Diversified', description: 'Barclays PLC provides various financial services in the United Kingdom and internationally.', currency: 'GBP', exchange: 'LSE' },
};

export class MockProvider extends MarketProvider {
  public getName(): string {
    return 'MockProvider';
  }

  public async getQuote(ticker: string): Promise<MarketQuote> {
    const baseline = BASELINES[ticker] || {
      name: `${ticker} Corp.`,
      price: 100.00,
      sector: 'Diversified',
      industry: 'Conglomerates',
      description: 'A mock public equity asset.',
      currency: 'USD',
      exchange: 'NASDAQ',
    };

    // Fluctuates between -1.5% and +1.5% around the baseline price
    const randomPercent = (Math.random() - 0.5) * 3; // -1.5 to +1.5
    const price = parseFloat((baseline.price * (1 + randomPercent / 100)).toFixed(2));
    const previousClose = parseFloat((baseline.price * (1 + (Math.random() - 0.5) * 1.5 / 100)).toFixed(2));
    
    const change = parseFloat((price - previousClose).toFixed(2));
    const changePercent = parseFloat(((change / previousClose) * 100).toFixed(2));
    const high = parseFloat((Math.max(price, previousClose) * 1.01).toFixed(2));
    const low = parseFloat((Math.min(price, previousClose) * 0.99).toFixed(2));
    const volume = Math.floor(Math.random() * 5000000) + 100000;

    return {
      ticker,
      price,
      change,
      changePercent,
      volume,
      high,
      low,
      open: previousClose,
      previousClose,
      timestamp: Date.now(),
    };
  }

  public async getCompanyProfile(ticker: string): Promise<CompanyProfile> {
    const baseline = BASELINES[ticker] || {
      name: `${ticker} Corp.`,
      price: 100.00,
      sector: 'Diversified',
      industry: 'Conglomerates',
      description: 'Mock company description details.',
      currency: 'USD',
      exchange: 'NASDAQ',
    };

    return {
      ticker,
      name: baseline.name,
      logo: `https://logo.clearbit.com/${baseline.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com` || 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3',
      description: baseline.description,
      sector: baseline.sector,
      industry: baseline.industry,
      ceo: 'John Doe',
      employees: 50000,
      marketCap: 150000000000,
      peRatio: 25.4,
      eps: 3.94,
      dividendYield: 1.25,
      beta: 1.10,
      high52Week: parseFloat((baseline.price * 1.25).toFixed(2)),
      low52Week: parseFloat((baseline.price * 0.8).toFixed(2)),
      currency: baseline.currency,
      exchange: baseline.exchange,
    };
  }

  public async getHistory(
    ticker: string,
    resolution: string,
    from: number,
    to: number
  ): Promise<MarketHistoryBar[]> {
    const baseline = BASELINES[ticker] || { price: 100.00 };
    const bars: MarketHistoryBar[] = [];
    
    // Choose step duration depending on resolution
    let step = 24 * 60 * 60; // default 1 day
    if (resolution === '1m') step = 60;
    else if (resolution === '5m') step = 5 * 60;
    else if (resolution === '1h') step = 60 * 60;

    let currentPrice = baseline.price;
    const now = Math.min(to, Date.now() / 1000);
    let currentTime = from;

    while (currentTime <= now) {
      const volatility = 0.003; // 0.3% max change per step
      const change = currentPrice * volatility * (Math.random() - 0.5) * 2;
      const open = currentPrice;
      const close = parseFloat((currentPrice + change).toFixed(2));
      const high = parseFloat((Math.max(open, close) * (1 + Math.random() * volatility)).toFixed(2));
      const low = parseFloat((Math.min(open, close) * (1 - Math.random() * volatility)).toFixed(2));
      const volume = Math.floor(Math.random() * 20000) + 1000;

      bars.push({
        time: currentTime,
        open,
        high,
        low,
        close,
        volume,
      });

      currentPrice = close;
      currentTime += step;
    }

    return bars;
  }

  public async searchTickers(
    query: string
  ): Promise<Array<{ ticker: string; name: string; exchange: string; assetType: string }>> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    const tickers = await prisma.ticker.findMany({
      where: {
        OR: [
          { id: { contains: cleanQuery, mode: 'insensitive' } },
          { name: { contains: cleanQuery, mode: 'insensitive' } },
          { sector: { contains: cleanQuery, mode: 'insensitive' } },
          { industry: { contains: cleanQuery, mode: 'insensitive' } },
        ],
      },
      take: 20,
    });

    return tickers.map((t) => ({
      ticker: t.id,
      name: t.name,
      exchange: t.exchangeId,
      assetType: t.assetType,
    }));
  }
}
