import { MarketProvider } from './base.provider';
import { MarketQuote, CompanyProfile, MarketHistoryBar } from '../types';
import { prisma } from '@stock-market/database';
import { AssetType } from '@prisma/client';

interface BaselineTicker {
  name: string;
  price: number;
  sector: string;
  industry: string;
  description: string;
  currency: string;
  exchange: string;
  assetType?: AssetType;
}

const BASELINES: Record<string, BaselineTicker> = {
  AAPL: { name: 'Apple Inc.', price: 224.30, sector: 'Technology', industry: 'Consumer Electronics', description: 'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide.', currency: 'USD', exchange: 'NASDAQ', assetType: AssetType.EQUITY },
  MSFT: { name: 'Microsoft Corp.', price: 415.20, sector: 'Technology', industry: 'Software—Infrastructure', description: 'Microsoft Corporation develops and supports software, services, devices, and solutions worldwide.', currency: 'USD', exchange: 'NASDAQ', assetType: AssetType.EQUITY },
  GOOGL: { name: 'Alphabet Inc.', price: 172.80, sector: 'Technology', industry: 'Internet Content & Information', description: 'Alphabet Inc. offers Google Search, YouTube, Google Cloud, and other internet services globally.', currency: 'USD', exchange: 'NASDAQ', assetType: AssetType.EQUITY },
  AMZN: { name: 'Amazon.com Inc.', price: 180.40, sector: 'Consumer Cyclical', industry: 'Internet Retail', description: 'Amazon.com, Inc. engages in the retail sale of consumer products and subscriptions in North America and internationally.', currency: 'USD', exchange: 'NASDAQ', assetType: AssetType.EQUITY },
  TSLA: { name: 'Tesla Inc.', price: 215.40, sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', description: 'Tesla, Inc. designs, develops, manufactures, leases, and sells electric vehicles, and energy generation and storage systems.', currency: 'USD', exchange: 'NASDAQ', assetType: AssetType.EQUITY },
  NVDA: { name: 'NVIDIA Corp.', price: 125.80, sector: 'Technology', industry: 'Semiconductors', description: 'NVIDIA Corporation provides graphics, and compute and networking solutions worldwide.', currency: 'USD', exchange: 'NASDAQ', assetType: AssetType.EQUITY },
  JPM: { name: 'JPMorgan Chase & Co.', price: 208.50, sector: 'Financial Services', industry: 'Banks—Diversified', description: 'JPMorgan Chase & Co. operates as a financial services company worldwide.', currency: 'USD', exchange: 'NYSE', assetType: AssetType.EQUITY },
  BARC: { name: 'Barclays PLC', price: 190.50, sector: 'Financial Services', industry: 'Banks—Diversified', description: 'Barclays PLC provides various financial services in the United Kingdom and internationally.', currency: 'GBP', exchange: 'LSE', assetType: AssetType.EQUITY },
  TXN: { name: 'Texas Instruments Inc.', price: 205.40, sector: 'Technology', industry: 'Semiconductors', description: 'Texas Instruments designs and manufactures semiconductors.', currency: 'USD', exchange: 'NASDAQ', assetType: AssetType.EQUITY },
  BAC: { name: 'Bank of America Corp.', price: 39.80, sector: 'Financial Services', industry: 'Banks—Diversified', description: 'Bank of America provides banking and financial products.', currency: 'USD', exchange: 'NYSE', assetType: AssetType.EQUITY },
  COST: { name: 'Costco Wholesale Corp.', price: 845.20, sector: 'Consumer Defensive', industry: 'Discount Stores', description: 'Costco operates membership warehouses.', currency: 'USD', exchange: 'NASDAQ', assetType: AssetType.EQUITY },
  ADBE: { name: 'Adobe Inc.', price: 520.10, sector: 'Technology', industry: 'Software—Application', description: 'Adobe provides digital media and marketing solutions.', currency: 'USD', exchange: 'NASDAQ', assetType: AssetType.EQUITY },
  CRM: { name: 'Salesforce, Inc.', price: 265.30, sector: 'Technology', industry: 'Software—Application', description: 'Salesforce provides customer relationship management technology.', currency: 'USD', exchange: 'NYSE', assetType: AssetType.EQUITY },
  NFLX: { name: 'Netflix, Inc.', price: 640.80, sector: 'Communication Services', industry: 'Entertainment', description: 'Netflix provides subscription streaming entertainment service.', currency: 'USD', exchange: 'NASDAQ', assetType: AssetType.EQUITY },
  META: { name: 'Meta Platforms, Inc.', price: 485.60, sector: 'Communication Services', industry: 'Internet Content & Information', description: 'Meta builds technologies that help people connect.', currency: 'USD', exchange: 'NASDAQ', assetType: AssetType.EQUITY },
  ORCL: { name: 'Oracle Corp.', price: 138.90, sector: 'Technology', industry: 'Software—Infrastructure', description: 'Oracle offers enterprise database software and cloud infrastructure.', currency: 'USD', exchange: 'NYSE', assetType: AssetType.EQUITY },
};

const BASE_VOLATILITIES: Record<AssetType, number> = {
  [AssetType.CRYPTO]: 0.02,        // 2%
  [AssetType.EQUITY]: 0.004,       // 0.4%
  [AssetType.ETF]: 0.0005,         // 0.05%
  [AssetType.INDEX]: 0.0005,       // 0.05%
  [AssetType.FOREX]: 0.0003,       // 0.03%
  [AssetType.COMMODITY]: 0.001,    // 0.1%
  [AssetType.BOND]: 0.0002,        // 0.02%
  [AssetType.MUTUAL_FUND]: 0.0004,  // 0.04%
  [AssetType.OPTION]: 0.05,        // 5%
  [AssetType.FUTURE]: 0.015,       // 1.5%
};

interface QuoteSnapshot {
  price: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  timestamp: number;
}

const QUOTE_CACHE_MS = Number(process.env.QUOTE_CACHE_MS) || 1000;

export class MockProvider extends MarketProvider {
  private static quoteCache: Map<string, QuoteSnapshot> = new Map();

  public getName(): string {
    return 'MockProvider';
  }

  private randomNormal(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  private getVolatility(assetType: AssetType, sector?: string): number {
    const base = BASE_VOLATILITIES[assetType] || 0.0015;
    let sectorMult = 1.0;
    if (sector) {
      const sLower = sector.toLowerCase();
      if (sLower.includes('tech') || sLower.includes('semi')) sectorMult = 1.25;
      else if (sLower.includes('financial') || sLower.includes('bank')) sectorMult = 0.85;
      else if (sLower.includes('cyclical') || sLower.includes('auto')) sectorMult = 1.15;
    }
    return base * sectorMult;
  }

  public async getQuote(ticker: string): Promise<MarketQuote> {
    const sym = ticker.toUpperCase().trim();
    const now = Date.now();

    const hash = sym.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const fallbackPrice = 60.0 + (hash % 240);

    const baseline = BASELINES[sym] || {
      name: `${sym} Corp.`,
      price: fallbackPrice,
      sector: 'Diversified',
      industry: 'Conglomerates',
      description: 'A mock public equity asset.',
      currency: 'USD',
      exchange: 'NASDAQ',
      assetType: AssetType.EQUITY,
    };

    // Check cache
    let cached = MockProvider.quoteCache.get(sym);
    if (cached && Math.abs(cached.price - baseline.price) > baseline.price * 0.25) {
      MockProvider.quoteCache.delete(sym);
      cached = undefined;
    }

    if (cached && (now - cached.timestamp < QUOTE_CACHE_MS)) {
      return {
        ticker: sym,
        price: cached.price,
        change: parseFloat((cached.price - cached.previousClose).toFixed(2)),
        changePercent: parseFloat((((cached.price - cached.previousClose) / cached.previousClose) * 100).toFixed(2)),
        volume: cached.volume,
        high: cached.high,
        low: cached.low,
        open: cached.open,
        previousClose: cached.previousClose,
        timestamp: cached.timestamp,
      };
    }

    let assetType = baseline.assetType || AssetType.EQUITY;
    let sector: string | undefined = baseline.sector;

    if (!BASELINES[sym]) {
      try {
        const dbTicker = await prisma.ticker.findUnique({
          where: { id: sym },
          include: { asset: true },
        });
        if (dbTicker) {
          if (dbTicker.asset) {
            assetType = dbTicker.asset.assetType;
            sector = dbTicker.asset.sector || undefined;
          } else {
            assetType = (dbTicker.assetType as AssetType) || AssetType.EQUITY;
            sector = dbTicker.sector || undefined;
          }
        }
      } catch (err) {
        // Ignored, use fallbacks
      }
    }

    let price = baseline.price;
    let previousClose = parseFloat((baseline.price * 0.99).toFixed(2));
    let open = previousClose;
    let high = price;
    let low = price;
    let volume = Math.floor(Math.random() * 5000000) + 100000;

    if (cached) {
      const volatility = this.getVolatility(assetType, sector);
      const step = this.randomNormal() * volatility;
      price = parseFloat((cached.price * (1 + step)).toFixed(2));
      previousClose = cached.previousClose;
      open = cached.open;
      high = parseFloat(Math.max(cached.high, price).toFixed(2));
      low = parseFloat(Math.min(cached.low, price).toFixed(2));
      volume = cached.volume + Math.floor(Math.random() * 10000);
    } else {
      const volatility = this.getVolatility(assetType, sector);
      const closeFluctuation = (Math.random() - 0.5) * volatility * 10;
      previousClose = parseFloat((baseline.price * (1 + closeFluctuation)).toFixed(2));
      open = previousClose;
      price = previousClose;
      high = price;
      low = price;
    }

    const snapshot: QuoteSnapshot = {
      price,
      open,
      high,
      low,
      previousClose,
      volume,
      timestamp: now,
    };

    MockProvider.quoteCache.set(sym, snapshot);

    const change = parseFloat((price - previousClose).toFixed(2));
    const changePercent = parseFloat(((change / previousClose) * 100).toFixed(2));

    return {
      ticker: sym,
      price,
      change,
      changePercent,
      volume,
      high,
      low,
      open,
      previousClose,
      timestamp: now,
    };
  }

  public async getCompanyProfile(ticker: string): Promise<CompanyProfile> {
    const sym = ticker.toUpperCase().trim();
    const baseline = BASELINES[sym] || {
      name: `${sym} Corp.`,
      price: 100.00,
      sector: 'Diversified',
      industry: 'Conglomerates',
      description: 'Mock company description details.',
      currency: 'USD',
      exchange: 'NASDAQ',
    };

    return {
      ticker: sym,
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
    const sym = ticker.toUpperCase().trim();
    const baseline = BASELINES[sym] || { price: 100.00 };
    const bars: MarketHistoryBar[] = [];

    let step = 24 * 60 * 60;
    if (resolution === '1m') step = 60;
    else if (resolution === '5m') step = 5 * 60;
    else if (resolution === '1h') step = 60 * 60;

    let currentPrice = baseline.price;
    const now = Math.min(to, Date.now() / 1000);
    let currentTime = from;

    while (currentTime <= now) {
      const volatility = 0.003;
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
