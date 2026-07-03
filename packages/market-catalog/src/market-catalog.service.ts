import { prisma } from '@stock-market/database';
import { Logger } from '@stock-market/logger';
import { MarketService } from '@stock-market/market';

export class MarketCatalogService {
  private static instance: MarketCatalogService | null = null;
  private marketService: MarketService;

  private constructor() {
    this.marketService = MarketService.getInstance();
  }

  public static getInstance(): MarketCatalogService {
    if (!this.instance) {
      this.instance = new MarketCatalogService();
    }
    return this.instance;
  }

  /**
   * Registers a dynamically discovered company metadata and its exchange on-the-fly.
   */
  public async registerDynamicDiscovery(tickerSymbol: string): Promise<any> {
    const sym = tickerSymbol.toUpperCase().trim();
    Logger.info(`[CATALOG] Dynamically discovering company metadata for: ${sym}`);

    try {
      // 1. Fetch rich company profile info from the market provider
      const profile = await this.marketService.getCompanyProfile(sym);
      const exchangeId = profile.exchange || 'NASDAQ';

      // 2. Ensure exchange exists to satisfy foreign key constraints
      await prisma.exchange.upsert({
        where: { id: exchangeId },
        update: {},
        create: {
          id: exchangeId,
          name: `${exchangeId} Stock Exchange`,
          country: profile.country || 'USA',
          timezone: 'America/New_York',
          openingTime: '09:30',
          closingTime: '16:00',
          currency: profile.currency || 'USD',
        },
      });

      // 3. Upsert the Ticker metadata
      const tickerRecord = await prisma.ticker.upsert({
        where: { id: sym },
        update: {
          name: profile.name,
          sector: profile.sector,
          industry: profile.industry,
          country: profile.country,
          currency: profile.currency || 'USD',
          isActive: true,
          lastMetadataUpdate: new Date(),
        },
        create: {
          id: sym,
          name: profile.name,
          assetType: 'STOCK',
          exchangeId: exchangeId,
          sector: profile.sector,
          industry: profile.industry,
          currency: profile.currency || 'USD',
          country: profile.country,
          isActive: true,
          isVerified: true,
          lastMetadataUpdate: new Date(),
        },
        include: { exchange: true },
      });

      Logger.info(`[CATALOG] Successfully registered dynamic ticker: ${sym} (${tickerRecord.name})`);
      return tickerRecord;
    } catch (err) {
      Logger.error(`[CATALOG] Failed to dynamically register ticker: ${sym}`, err);
      throw err;
    }
  }

  /**
   * Refreshes metadata for a specific ticker to keep sectors/names up to date.
   */
  public async refreshTickerMetadata(tickerId: string): Promise<void> {
    try {
      const profile = await this.marketService.getCompanyProfile(tickerId);
      
      await prisma.ticker.update({
        where: { id: tickerId },
        data: {
          name: profile.name,
          sector: profile.sector,
          industry: profile.industry,
          country: profile.country,
          isActive: true,
          lastMetadataUpdate: new Date(),
        },
      });
      Logger.info(`[CATALOG] Refreshed metadata for ticker: ${tickerId}`);
    } catch (err) {
      Logger.error(`[CATALOG] Failed to refresh metadata for ticker: ${tickerId}, flagging as inactive`, err);
      try {
        await prisma.ticker.update({
          where: { id: tickerId },
          data: {
            isActive: false,
            lastMetadataUpdate: new Date(),
          },
        });
      } catch (dbErr) {
        Logger.error(`[CATALOG] Failed to mark ticker ${tickerId} as inactive in DB`, dbErr);
      }
    }
  }
}
