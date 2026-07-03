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

    // Real-world primary provider, falls back to Mock if connections fail
    this.primaryProvider = new YahooFinanceProvider();
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

  // --- Core API Interfaces ---

  public async getQuote(ticker: string): Promise<MarketQuote> {
    const cacheKey = `quote:${ticker.toUpperCase()}`;
    
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

    // Fetch via provider with circuit breaker
    const quote = await this.executeWithCircuitBreaker((provider) => 
      provider.getQuote(ticker)
    );

    // Check alerts asynchronously
    this.checkAlerts(ticker, quote.price).catch((err) => 
      Logger.error(`Alert checks failed for ${ticker}`, err)
    );

    // Save in cache (15 seconds)
    try {
      if (this.redis.isOpen) {
        await this.redis.setEx(cacheKey, 15, JSON.stringify(quote));
      }
    } catch (err) {
      Logger.error('Redis write error inside getQuote', err);
    }

    return quote;
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
    const cacheKey = `history:${ticker.toUpperCase()}:${resolution}:${from}:${to}`;

    try {
      if (this.redis.isOpen) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as MarketHistoryBar[];
        }
      }
    } catch (err) {
      Logger.error('Redis read error inside getHistory', err);
    }

    const history = await this.executeWithCircuitBreaker((provider) =>
      provider.getHistory(ticker, resolution, from, to)
    );

    try {
      if (this.redis.isOpen) {
        await this.redis.setEx(cacheKey, 300, JSON.stringify(history)); // Cache for 5 minutes
      }
    } catch (err) {
      Logger.error('Redis write error inside getHistory', err);
    }

    return history;
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
