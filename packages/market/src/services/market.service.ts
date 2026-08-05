import { createClient, RedisClientType } from 'redis';
import { ConfigService } from '@stock-market/config';
import { Logger } from '@stock-market/logger';
import { MarketProvider } from '../providers/base.provider';
import { MockProvider } from '../providers/mock.provider';
import { YahooFinanceProvider } from '../providers/yahoo.provider';
import { MarketQuote, CompanyProfile, MarketHistoryBar } from '../types';

const config = ConfigService.getInstance();

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class MarketService {
  private static instance: MarketService;
  
  private redis: RedisClientType;
  private primaryProvider: MarketProvider;
  private fallbackProvider: MarketProvider;

  // Circuit Breaker attributes
  private circuitState: CircuitState = 'CLOSED';
  private failureCount = 0;
  private maxFailures = 3;
  private cooldownMs = 30000; // 30 seconds
  private lastStateChange: number = Date.now();

  private constructor() {
    this.redis = createClient({
      url: config.get('REDIS_URL'),
    });
    this.redis.on('error', (err) => Logger.error('MarketService Redis Error', err));
    this.redis.connect().catch((err) => Logger.error('MarketService Redis Connection Failed', err));

    const providerType = config.get('MARKET_PROVIDER');
    if (providerType === 'mock') {
      Logger.info('[MARKET SERVICE] Using MockProvider as the primary market provider.');
      this.primaryProvider = new MockProvider();
    } else {
      Logger.info('[MARKET SERVICE] Using YahooFinanceProvider as the primary market provider.');
      this.primaryProvider = new YahooFinanceProvider();
    }
    this.fallbackProvider = new MockProvider();
  }

  public static getInstance(): MarketService {
    if (!MarketService.instance) {
      MarketService.instance = new MarketService();
    }
    return MarketService.instance;
  }

  // Circuit Breaker State Transition Helpers
  private transitionTo(state: CircuitState) {
    if (this.circuitState !== state) {
      Logger.warn(`Market Circuit Breaker transitioned from ${this.circuitState} to ${state}`);
      this.circuitState = state;
      this.lastStateChange = Date.now();
    }
  }

  // Wrapper that executes target provider tasks with failure counts and cooldown checks
  private async executeWithCircuitBreaker<T>(
    operation: (provider: MarketProvider) => Promise<T>
  ): Promise<T> {
    // 1. Check if circuit is open
    if (this.circuitState === 'OPEN') {
      const elapsed = Date.now() - this.lastStateChange;
      if (elapsed > this.cooldownMs) {
        // Cooldown passed, transition to half-open to test primary
        this.transitionTo('HALF_OPEN');
      } else {
        // Use fallback immediately
        Logger.info('Circuit open. Routing call to fallback provider.');
        return operation(this.fallbackProvider);
      }
    }

    const activeProvider = this.circuitState === 'CLOSED' ? this.primaryProvider : this.primaryProvider;

    try {
      const result = await operation(activeProvider);
      
      // If we succeed in half-open, close the circuit
      if (this.circuitState === 'HALF_OPEN') {
        this.failureCount = 0;
        this.transitionTo('CLOSED');
      }
      
      return result;
    } catch (error) {
      Logger.error(`Provider operation failed on ${activeProvider.getName()}`, error);
      
      this.failureCount++;
      if (this.failureCount >= this.maxFailures) {
        this.transitionTo('OPEN');
      }
      
      // Fallback
      Logger.warn(`Routing request to fallback provider due to error.`);
      return operation(this.fallbackProvider);
    }
  }

  public async getExchangeRate(from: string, to: string): Promise<number> {
    const f = from.toUpperCase().trim();
    const t = to.toUpperCase().trim();
    if (f === t) return 1.0;

    const cacheKey = `fx:${f}:${t}`;
    try {
      if (this.redis.isOpen) {
        const cached = await this.redis.get(cacheKey);
        if (cached) return parseFloat(cached);
      }
    } catch {}

    const staticRates: Record<string, number> = {
      USD: 1.0,
      EUR: 1.08,
      GBP: 1.27,
      INR: 0.012,
      AUD: 0.66,
      CAD: 0.73,
    };

    let rate = 1.0;
    try {
      // Query Yahoo for fx ticker (e.g. GBPUSD=X)
      const fxTicker = `${f}${t}=X`;
      const fxQuote = await this.executeWithCircuitBreaker((provider) =>
        provider.getQuote(fxTicker)
      );
      rate = fxQuote.price;
    } catch {
      // Fallback to static rates
      const fromUsd = staticRates[f] || 1.0;
      const toUsd = staticRates[t] || 1.0;
      rate = fromUsd / toUsd;
    }

    try {
      if (this.redis.isOpen) {
        await this.redis.setEx(cacheKey, 3600, rate.toString()); // Cache FX rate for 1 hour
      }
    } catch {}

    return rate;
  }

  // --- Core API Interfaces ---

  public async getQuote(ticker: string): Promise<MarketQuote> {
    const sym = ticker.toUpperCase().trim();
    const cacheKey = `quote:${sym}`;
    
    // Check cache
    try {
      if (this.redis.isOpen) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as MarketQuote;
        }
      }
    } catch (err) {
      Logger.error('Redis read error inside getQuote', err);
    }

    const { prisma } = await import('@stock-market/database');
    const tickerRec = await prisma.ticker.findUnique({
      where: { id: sym }
    });
    const providerSymbol = tickerRec?.providerSymbol || sym;

    // Fetch via provider with circuit breaker
    const quote = await this.executeWithCircuitBreaker((provider) => 
      provider.getQuote(providerSymbol)
    );

    // Map provider ticker symbol back to database ticker ID
    quote.ticker = sym;

    // Convert prices to USD if native currency is not USD and not already converted
    const originalCurrency = tickerRec?.currency || 'USD';
    if (originalCurrency !== 'USD' && !(quote as any).isConverted) {
      try {
        const fxRate = await this.getExchangeRate(originalCurrency, 'USD');
        quote.price = parseFloat((quote.price * fxRate).toFixed(4));
        quote.high = parseFloat((quote.high * fxRate).toFixed(4));
        quote.low = parseFloat((quote.low * fxRate).toFixed(4));
        quote.open = parseFloat((quote.open * fxRate).toFixed(4));
        quote.previousClose = parseFloat((quote.previousClose * fxRate).toFixed(4));
        quote.change = parseFloat((quote.change * fxRate).toFixed(4));
        (quote as any).isConverted = true;
      } catch (err) {
        Logger.error(`[FX CONVERSION] getQuote USD conversion failed for ${sym}`, err);
      }
    }

    // Check alerts asynchronously
    this.checkAlerts(sym, quote.price).catch((err) => 
      Logger.error(`Alert checks failed for ${sym}`, err)
    );

    // Save in cache (1s for mock, 5s for Yahoo)
    const providerType = config.get('MARKET_PROVIDER');
    const defaultCacheSec = providerType === 'mock' ? 1 : 5;
    const QUOTE_CACHE_SEC = Number(process.env.QUOTE_CACHE_SEC) || defaultCacheSec;

    try {
      if (this.redis.isOpen) {
        await this.redis.setEx(cacheKey, QUOTE_CACHE_SEC, JSON.stringify(quote));
      }
    } catch (err) {
      Logger.error('Redis write error inside getQuote', err);
    }

    return quote;
  }

  public async getQuotes(tickers: string[]): Promise<Record<string, MarketQuote>> {
    if (tickers.length === 0) return {};

    const results: Record<string, MarketQuote> = {};
    const missingTickers: string[] = [];

    // 1. Check Redis cache first
    try {
      if (this.redis.isOpen) {
        const cacheKeys = tickers.map(t => `quote:${t.toUpperCase().trim()}`);
        const cachedVals = await this.redis.mGet(cacheKeys);
        for (let i = 0; i < tickers.length; i++) {
          const ticker = tickers[i].toUpperCase().trim();
          const cached = cachedVals[i];
          if (cached) {
            results[ticker] = JSON.parse(cached) as MarketQuote;
          } else {
            missingTickers.push(tickers[i]);
          }
        }
      } else {
        missingTickers.push(...tickers);
      }
    } catch (err) {
      Logger.error('Redis mGet error inside getQuotes', err);
      missingTickers.push(...tickers);
    }

    if (missingTickers.length === 0) {
      return results;
    }

    // 2. Resolve provider symbols from database for the missing tickers
    const { prisma } = await import('@stock-market/database');
    const dbTickers = await prisma.ticker.findMany({
      where: { id: { in: missingTickers.map(t => t.toUpperCase().trim()) } }
    });

    const symbolToTickerMap: Record<string, string> = {};
    const missingProviderSymbols: string[] = [];

    for (const t of missingTickers) {
      const sym = t.toUpperCase().trim();
      const rec = dbTickers.find(d => d.id === sym);
      const pSym = (rec?.providerSymbol && rec.providerSymbol.trim() !== '' ? rec.providerSymbol : sym).toUpperCase().trim();
      symbolToTickerMap[pSym] = sym;
      missingProviderSymbols.push(pSym);
    }

    // 3. Fetch missing tickers via provider in batch
    let batchQuotes: Record<string, MarketQuote> = {};
    try {
      batchQuotes = await this.executeWithCircuitBreaker((provider) =>
        provider.getQuotes(missingProviderSymbols)
      );
    } catch (err) {
      Logger.warn(`Routing batch quote request to fallback provider due to error.`);
      try {
        batchQuotes = await this.fallbackProvider.getQuotes(missingProviderSymbols);
      } catch {
        // ignore
      }
    }

    // 4. Cache results and merge into final results
    const providerType = config.get('MARKET_PROVIDER');
    const defaultCacheSec = providerType === 'mock' ? 1 : 5;
    const QUOTE_CACHE_SEC = Number(process.env.QUOTE_CACHE_SEC) || defaultCacheSec;

    for (const [pSym, quote] of Object.entries(batchQuotes)) {
      const originalTicker = symbolToTickerMap[pSym.toUpperCase().trim()];
      if (originalTicker) {
        quote.ticker = originalTicker; // Rewrite ticker symbol back to database ID

        // Convert prices to USD if native currency is not USD and not already converted
        const rec = dbTickers.find(d => d.id === originalTicker);
        const originalCurrency = rec?.currency || 'USD';
        if (originalCurrency !== 'USD' && !(quote as any).isConverted) {
          try {
            const fxRate = await this.getExchangeRate(originalCurrency, 'USD');
            quote.price = parseFloat((quote.price * fxRate).toFixed(4));
            quote.high = parseFloat((quote.high * fxRate).toFixed(4));
            quote.low = parseFloat((quote.low * fxRate).toFixed(4));
            quote.open = parseFloat((quote.open * fxRate).toFixed(4));
            quote.previousClose = parseFloat((quote.previousClose * fxRate).toFixed(4));
            quote.change = parseFloat((quote.change * fxRate).toFixed(4));
            (quote as any).isConverted = true;
          } catch (err) {
            Logger.error(`[FX CONVERSION] getQuotes USD conversion failed for ${originalTicker}`, err);
          }
        }

        results[originalTicker] = quote;

        // Cache asynchronously
        const cacheKey = `quote:${originalTicker}`;
        try {
          if (this.redis.isOpen) {
            await this.redis.setEx(cacheKey, QUOTE_CACHE_SEC, JSON.stringify(quote));
          }
        } catch (err) {
          Logger.error(`Redis write error inside getQuotes for ${originalTicker}`, err);
        }
      }
    }

    return results;
  }

  public async getCompanyProfile(ticker: string): Promise<CompanyProfile> {
    const cacheKey = `profile:${ticker.toUpperCase()}`;

    try {
      if (this.redis.isOpen) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as CompanyProfile;
        }
      }
    } catch (err) {
      Logger.error('Redis read error inside getCompanyProfile', err);
    }

    const profile = await this.executeWithCircuitBreaker((provider) =>
      provider.getCompanyProfile(ticker)
    );

    // Dynamically register/upsert the ticker in the PostgreSQL database so it is tradeable
    try {
      const { prisma } = await import('@stock-market/database');
      
      const exchangeId = profile.exchange || 'NASDAQ';
      await prisma.exchange.upsert({
        where: { id: exchangeId },
        update: {},
        create: {
          id: exchangeId,
          name: `${exchangeId} Stock Exchange`,
          country: 'US',
          timezone: 'America/New_York',
          openingTime: '09:30',
          closingTime: '16:00',
          currency: profile.currency || 'USD',
        },
      });

      await prisma.ticker.upsert({
        where: { id: ticker.toUpperCase() },
        update: {
          name: profile.name,
          sector: profile.sector,
          industry: profile.industry,
        },
        create: {
          id: ticker.toUpperCase(),
          name: profile.name,
          assetType: 'STOCK',
          exchangeId,
          sector: profile.sector,
          industry: profile.industry,
          currency: profile.currency || 'USD',
        },
      });
    } catch (dbErr) {
      Logger.error(`Failed to dynamically register ticker ${ticker} in DB`, dbErr);
    }

    try {
      if (this.redis.isOpen) {
        await this.redis.setEx(cacheKey, 86400, JSON.stringify(profile)); // Cache for 24 hours
      }
    } catch (err) {
      Logger.error('Redis write error inside getCompanyProfile', err);
    }

    return profile;
  }

  public async getHistory(
    ticker: string,
    resolution: string,
    from: number,
    to: number
  ): Promise<MarketHistoryBar[]> {
    const sym = ticker.toUpperCase().trim();
    const fromDate = new Date(from * 1000);
    const toDate = new Date(to * 1000);

    const { prisma } = await import('@stock-market/database');
    const { Decimal } = await import('@prisma/client/runtime/library');

    let bars: MarketHistoryBar[] = [];

    // 1. Try reading candles from database first
    try {
      const dbCandles = await prisma.oHLCCandle.findMany({
        where: {
          tickerId: sym,
          timeframe: resolution,
          timestamp: {
            gte: fromDate,
            lte: toDate,
          },
        },
        orderBy: { timestamp: 'asc' },
      });

      if (dbCandles.length > 0) {
        Logger.info(`[CANDLE STORAGE] Retrieved ${dbCandles.length} candles from DB for ${sym} (${resolution})`);
        bars = dbCandles.map((c) => ({
          time: Math.floor(c.timestamp.getTime() / 1000),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: Number(c.volume),
        }));
      }
    } catch (err) {
      Logger.error('[CANDLE STORAGE] Error reading candles from DB', err);
    }

    if (bars.length === 0) {
      // 2. Fetch from provider
      const history = await this.executeWithCircuitBreaker((provider) =>
        provider.getHistory(sym, resolution, from, to)
      );

      // 3. Save/Backfill to database asynchronously
      if (history.length > 0) {
        (async () => {
          try {
            Logger.info(`[CANDLE STORAGE] Backfilling ${history.length} candles to DB for ${sym} (${resolution})`);
            
            const dataToInsert = history.map((bar) => ({
              tickerId: sym,
              timeframe: resolution,
              open: new Decimal(bar.open),
              high: new Decimal(bar.high),
              low: new Decimal(bar.low),
              close: new Decimal(bar.close),
              volume: new Decimal(bar.volume),
              timestamp: new Date(bar.time * 1000),
            }));

            await prisma.oHLCCandle.createMany({
              data: dataToInsert,
              skipDuplicates: true,
            });
          } catch (err) {
            Logger.error('[CANDLE STORAGE] Error backfilling candles to DB', err);
          }
        })().catch((err) => Logger.error('[CANDLE STORAGE] Background task crashed', err));
      }
      bars = history;
    }

    // 4. Convert bars to USD if ticker's native currency is not USD
    try {
      const tickerRec = await prisma.ticker.findUnique({ where: { id: sym } });
      const originalCurrency = tickerRec?.currency || 'USD';
      if (originalCurrency !== 'USD') {
        const fxRate = await this.getExchangeRate(originalCurrency, 'USD');
        for (const bar of bars) {
          bar.open = parseFloat((bar.open * fxRate).toFixed(4));
          bar.high = parseFloat((bar.high * fxRate).toFixed(4));
          bar.low = parseFloat((bar.low * fxRate).toFixed(4));
          bar.close = parseFloat((bar.close * fxRate).toFixed(4));
        }
      }
    } catch (err) {
      Logger.error(`[FX CONVERSION] History USD conversion failed for ${sym}`, err);
    }

    return bars;
  }

  public async searchTickers(
    query: string
  ): Promise<Array<{ ticker: string; name: string; exchange: string; assetType: string }>> {
    // Search is always bypassed from cache to support real-time user keystrokes
    return this.executeWithCircuitBreaker((provider) =>
      provider.searchTickers(query)
    );
  }

  /**
   * Scans price alerts for a given ticker and dispatches notifications for rule triggers
   */
  private async checkAlerts(tickerId: string, currentPrice: number): Promise<void> {
    try {
      const { prisma } = await import('@stock-market/database');
      const { NotificationService } = await import('@stock-market/notifications');

      const activeAlerts = await prisma.alert.findMany({
        where: {
          tickerId: tickerId.toUpperCase(),
          isTriggered: false,
        },
      });

      for (const alert of activeAlerts) {
        const triggerValue = Number(alert.value);
        let shouldTrigger = false;

        if (alert.condition === 'ABOVE' && currentPrice >= triggerValue) {
          shouldTrigger = true;
        } else if (alert.condition === 'BELOW' && currentPrice <= triggerValue) {
          shouldTrigger = true;
        }

        if (shouldTrigger) {
          // Atomic update to prevent multiple triggers
          await prisma.alert.update({
            where: { id: alert.id },
            data: { isTriggered: true },
          });

          // Dispatch notification
          const notificationService = NotificationService.getInstance();
          await notificationService.sendAlertNotification({
            alertId: alert.id,
            userId: alert.userId,
            symbol: alert.tickerId,
            condition: alert.condition as 'ABOVE' | 'BELOW',
            value: triggerValue,
            currentPrice,
          });

          Logger.info(`Alert triggered: ${alert.id} - ${alert.tickerId} is ${alert.condition} ${alert.value} (current: ${currentPrice})`);
        }
      }
    } catch (err) {
      Logger.error(`Error in checkAlerts for ${tickerId}`, err);
    }
  }
}
export default MarketService;
