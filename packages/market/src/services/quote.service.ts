import { MarketService } from './market.service';
import { QuoteInterestService } from './interest.service';
import { MarketQuote } from '../types';
import { Logger } from '@stock-market/logger';
import { ConfigService } from '@stock-market/config';
import { createClient, RedisClientType } from 'redis';

export class QuoteService {
  private static instance: QuoteService | null = null;
  private marketService: MarketService;
  private interestService: QuoteInterestService;
  private redis: RedisClientType;
  private pollingInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.marketService = MarketService.getInstance();
    this.interestService = QuoteInterestService.getInstance();

    const config = ConfigService.getInstance();
    const redisUrl = config.get('REDIS_URL') || 'redis://localhost:6379';
    this.redis = createClient({ url: redisUrl }) as any;
    
    this.redis.connect().catch((err) => {
      Logger.error('[QUOTE SERVICE] Failed to connect to Redis', err);
    });
  }

  public static getInstance(): QuoteService {
    if (!this.instance) {
      this.instance = new QuoteService();
    }
    return this.instance;
  }

  /**
   * Retrieves a live quote with short-lived Redis caching (10s TTL)
   */
  public async getLiveQuote(symbol: string): Promise<MarketQuote> {
    const sym = symbol.toUpperCase().trim();
    const cacheKey = `livequote:${sym}`;

    try {
      if (this.redis.isOpen) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as MarketQuote;
        }
      }
    } catch (err) {
      Logger.error(`[QUOTE SERVICE] Redis read error for ${sym}`, err);
    }

    // Cache miss - Fetch a fresh quote
    const quote = await this.marketService.getQuote(sym);

    // Save to Redis with 10s expiration
    try {
      if (this.redis.isOpen) {
        await this.redis.setEx(cacheKey, 10, JSON.stringify(quote));
      }
    } catch (err) {
      Logger.error(`[QUOTE SERVICE] Redis write error for ${sym}`, err);
    }

    return quote;
  }

  /**
   * Starts a background polling loop that streams price updates for active symbols
   */
  public startPolling(onQuoteUpdate?: (quote: MarketQuote) => void): void {
    if (this.pollingInterval) return;

    Logger.info('[QUOTE SERVICE] Starting intelligent quote polling loop with Redis Pub/Sub publishing...');

    this.pollingInterval = setInterval(async () => {
      const activeSymbols = this.interestService.getActiveSymbols();
      if (activeSymbols.length === 0) return;

      Logger.info(`[QUOTE SERVICE] Polling live prices for ${activeSymbols.length} active symbols: ${activeSymbols.join(', ')}`);

      // Batch retrieve quotes for active symbols to optimize performance
      let quotesMap: Record<string, MarketQuote> = {};
      try {
        quotesMap = await this.marketService.getQuotes(activeSymbols);
      } catch (err) {
        Logger.error('[QUOTE SERVICE] Failed to batch fetch quotes', err);
      }

      for (const sym of activeSymbols) {
        try {
          const quote = quotesMap[sym] || await this.marketService.getQuote(sym);

          // Update cache
          const cacheKey = `livequote:${sym}`;
          if (this.redis.isOpen) {
            await this.redis.setEx(cacheKey, 10, JSON.stringify(quote));
            await this.redis.publish('market:ticks', JSON.stringify(quote));
          }

          // Emit update callback if provided
          if (onQuoteUpdate) {
            onQuoteUpdate(quote);
          }
        } catch (err) {
          Logger.error(`[QUOTE SERVICE] Failed to poll live price for ${sym}`, err);
        }
      }
    }, 5000); // Poll every 5 seconds
  }

  /**
   * Stops the background polling loop
   */
  public stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      Logger.info('[QUOTE SERVICE] Stopped intelligent quote polling loop.');
    }
  }
}
