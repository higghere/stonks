import { prisma } from '@stock-market/database';
import { Logger } from '@stock-market/logger';
import { AssetRegistry } from '@stock-market/market-catalog';
import { QueueStatus, DiscoveryStatus } from '@prisma/client';

const CRAWL_SEQUENCES: Record<string, string[]> = {
  NASDAQ: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX', 'AMD', 'INTC', 'ADBE', 'CRM', 'ORCL', 'CSCO', 'AVGO', 'ASML', 'QCOM', 'TXN', 'AMAT', 'MU', 'ISRG', 'LRCX', 'ADP', 'PANW', 'VRTX', 'REGN', 'MDLZ', 'KDP', 'MNST', 'SBUX', 'MELI', 'INTU', 'AMGN', 'GILD', 'ADI', 'PDD', 'SNPS', 'CDNS', 'KLAC', 'NXPI', 'MAR', 'WDAY', 'CTAS', 'PCAR', 'ORLY', 'LULU', 'PAYX', 'ADSK', 'AEP'],
  NYSE: ['JPM', 'BAC', 'WFC', 'MS', 'GS', 'V', 'MA', 'WMT', 'TGT', 'KO', 'PEP', 'NKE', 'MCD', 'DIS', 'LLY', 'JNJ', 'PFE', 'CAT', 'GE', 'BA', 'XOM', 'CVX', 'BRK-B', 'UNH', 'HD', 'PG', 'ABBV', 'MRK', 'T', 'VZ', 'NVO', 'AZN', 'NVS', 'TM', 'HSBC', 'BABA', 'SAP', 'HDB', 'IBN', 'INFY', 'WIT', 'BTI', 'DEO', 'BP', 'SHEL', 'UL'],
};

export class CatalogWorker {
  private crawlTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private enrichmentTimer: NodeJS.Timeout | null = null;

  private registry: AssetRegistry;
  private isCrawling = false;
  private isRefreshing = false;
  private isProcessingDiscovery = false;
  private isProcessingEnrichment = false;

  constructor() {
    this.registry = AssetRegistry.getInstance();
  }

  public start(): void {
    Logger.info('[CATALOG WORKER] Starting dynamic catalog, discovery, and enrichment worker loops...');

    const isDev = process.env.NODE_ENV === 'development';

    // 1. Crawler (Optional/Configurable exchange crawl): Run every 45s (dev: 15s)
    const enableCrawler = process.env.ENABLE_CRAWLER === 'true' || isDev;
    if (enableCrawler) {
      const crawlInterval = isDev ? 15000 : 45000;
      this.crawlTimer = setInterval(() => this.crawlNextStep(), crawlInterval);
      setTimeout(() => this.crawlNextStep(), 2000);
    }

    // 2. Metadata Refresh Loop: Run hourly
    this.refreshTimer = setInterval(() => this.runMetadataRefreshCycle(), 3600000);
    setTimeout(() => this.runMetadataRefreshCycle(), 10000);

    // 3. Discovery Queue Worker: Run every 5 seconds
    this.discoveryTimer = setInterval(() => this.processDiscoveryQueue(), 5000);
    setTimeout(() => this.processDiscoveryQueue(), 3000);

    // 4. Enrichment Queue Worker: Run every 10 seconds
    this.enrichmentTimer = setInterval(() => this.processEnrichmentQueue(), 10000);
    setTimeout(() => this.processEnrichmentQueue(), 6000);
  }

  public stop(): void {
    if (this.crawlTimer) clearInterval(this.crawlTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    if (this.enrichmentTimer) clearInterval(this.enrichmentTimer);
    Logger.info('[CATALOG WORKER] Stopped background catalog worker loops.');
  }

  /**
   * Periodically scans listings to discover assets passively
   */
  private async crawlNextStep(): Promise<void> {
    if (this.isCrawling) return;
    this.isCrawling = true;

    try {
      const exchanges = Object.keys(CRAWL_SEQUENCES);
      for (const exId of exchanges) {
        let crawlState = await prisma.exchangeCrawlState.findUnique({
          where: { exchangeId: exId }
        });

        if (!crawlState) {
          crawlState = await prisma.exchangeCrawlState.create({
            data: { exchangeId: exId, lastOffset: 0, isCompleted: false }
          });
        }

        if (crawlState.isCompleted) continue;

        const symbols = CRAWL_SEQUENCES[exId];
        const offset = crawlState.lastOffset;

        if (offset >= symbols.length) {
          await prisma.exchangeCrawlState.update({
            where: { exchangeId: exId },
            data: { isCompleted: true }
          });
          Logger.info(`[CATALOG CRAWLER] Completed exchange crawl: ${exId}`);
          continue;
        }

        const nextSymbol = symbols[offset];
        Logger.info(`[CATALOG CRAWLER] Passive Discovery for ticker: ${nextSymbol} on ${exId}`);

        // Register via minimal discovery
        await this.registry.registerDiscoveredShort(nextSymbol, undefined, exId);

        await prisma.exchangeCrawlState.update({
          where: { exchangeId: exId },
          data: { lastOffset: offset + 1 }
        });
        break;
      }
    } catch (err) {
      Logger.error('[CATALOG CRAWLER] Crawl step execution failed', err);
    } finally {
      this.isCrawling = false;
    }
  }

  /**
   * Processes the Discovery Queue with exponential backoff
   */
  private async processDiscoveryQueue(): Promise<void> {
    if (this.isProcessingDiscovery) return;
    this.isProcessingDiscovery = true;

    try {
      const now = new Date();
      const jobs = await prisma.discoveryQueue.findMany({
        where: {
          status: { in: [QueueStatus.PENDING, QueueStatus.FAILED] },
          nextAttempt: { lte: now },
        },
        orderBy: [
          { priority: 'desc' },
          { nextAttempt: 'asc' },
        ],
        take: 5,
      });

      for (const job of jobs) {
        Logger.info(`[DISCOVERY WORKER] Processing symbol: ${job.symbol} (Priority: ${job.priority})`);
        
        await prisma.discoveryQueue.update({
          where: { id: job.id },
          data: { status: QueueStatus.PROCESSING, startedAt: new Date() },
        });

        try {
          await this.registry.registerDiscoveredShort(job.symbol, job.name || undefined, job.exchangeId || undefined);
          
          await prisma.discoveryQueue.update({
            where: { id: job.id },
            data: { status: QueueStatus.COMPLETED, completedAt: new Date() },
          });
        } catch (err) {
          const nextRetries = job.retries + 1;
          const backoffDelay = Math.min(Math.pow(2, nextRetries) * 5000, 24 * 60 * 60 * 1000);
          
          await prisma.discoveryQueue.update({
            where: { id: job.id },
            data: {
              status: QueueStatus.FAILED,
              retries: nextRetries,
              nextAttempt: new Date(Date.now() + backoffDelay),
            },
          });
          Logger.error(`[DISCOVERY WORKER] Job failed for ${job.symbol}, retrying in ${backoffDelay / 1000}s`, err);
        }
      }
    } catch (err) {
      Logger.error('[DISCOVERY WORKER] Error processing queue', err);
    } finally {
      this.isProcessingDiscovery = false;
    }
  }

  /**
   * Processes the Enrichment Queue with exponential backoff
   */
  private async processEnrichmentQueue(): Promise<void> {
    if (this.isProcessingEnrichment) return;
    this.isProcessingEnrichment = true;

    try {
      const now = new Date();
      const jobs = await prisma.enrichmentQueue.findMany({
        where: {
          status: { in: [QueueStatus.PENDING, QueueStatus.FAILED] },
          nextAttempt: { lte: now },
        },
        orderBy: [
          { priority: 'desc' },
          { nextAttempt: 'asc' },
        ],
        take: 5,
      });

      for (const job of jobs) {
        Logger.info(`[ENRICHMENT WORKER] Processing enrichment for symbol: ${job.symbol}`);

        await prisma.enrichmentQueue.update({
          where: { id: job.id },
          data: { status: QueueStatus.PROCESSING, startedAt: new Date() },
        });

        try {
          await this.registry.enrichAsset(job.symbol);

          await prisma.enrichmentQueue.update({
            where: { id: job.id },
            data: { status: QueueStatus.COMPLETED, completedAt: new Date() },
          });
        } catch (err) {
          const nextRetries = job.retries + 1;
          const backoffDelay = Math.min(Math.pow(2, nextRetries) * 5000, 24 * 60 * 60 * 1000);

          await prisma.enrichmentQueue.update({
            where: { id: job.id },
            data: {
              status: QueueStatus.FAILED,
              retries: nextRetries,
              nextAttempt: new Date(Date.now() + backoffDelay),
            },
          });
          Logger.error(`[ENRICHMENT WORKER] Job failed for ${job.symbol}, retrying in ${backoffDelay / 1000}s`, err);
        }
      }
    } catch (err) {
      Logger.error('[ENRICHMENT WORKER] Error processing queue', err);
    } finally {
      this.isProcessingEnrichment = false;
    }
  }

  /**
   * Refreshes metadata for tickers older than 30 days by enqueuing them back into the EnrichmentQueue
   */
  private async runMetadataRefreshCycle(): Promise<void> {
    if (this.isRefreshing) return;
    this.isRefreshing = true;

    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Find verified assets that haven't been verified in 30 days
      const outdatedAssets = await prisma.asset.findMany({
        where: {
          status: DiscoveryStatus.VERIFIED,
          OR: [
            { lastVerifiedAt: { lt: thirtyDaysAgo } },
            { lastVerifiedAt: null },
          ],
        },
        include: { listings: true },
        take: 10,
      });

      if (outdatedAssets.length > 0) {
        Logger.info(`[CATALOG REFRESHER] Found ${outdatedAssets.length} verified assets needing refresh.`);
        for (const asset of outdatedAssets) {
          // Get first listing to refresh by symbol
          const listing = asset.listings[0];
          if (listing) {
            await this.registry.enqueueEnrichment(listing.id);
          }
        }
      }
    } catch (err) {
      Logger.error('[CATALOG REFRESHER] Error during metadata refresh cycle', err);
    } finally {
      this.isRefreshing = false;
    }
  }
}
