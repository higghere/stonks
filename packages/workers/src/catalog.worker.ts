import { prisma } from '@stock-market/database';
import { Logger } from '@stock-market/logger';
import { MarketCatalogService } from '@stock-market/market-catalog';

const CRAWL_SEQUENCES: Record<string, string[]> = {
  NASDAQ: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX', 'AMD', 'INTC', 'ADBE', 'CRM', 'ORCL', 'CSCO', 'AVGO', 'ASML', 'QCOM', 'TXN', 'AMAT', 'MU', 'ISRG', 'LRCX', 'ADP', 'PANW', 'VRTX', 'REGN', 'MDLZ', 'KDP', 'MNST', 'SBUX', 'MELI', 'INTU', 'AMGN', 'GILD', 'ADI', 'PDD', 'SNPS', 'CDNS', 'KLAC', 'NXPI', 'MAR', 'WDAY', 'CTAS', 'PCAR', 'ORLY', 'LULU', 'PAYX', 'ADSK', 'AEP'],
  NYSE: ['JPM', 'BAC', 'WFC', 'MS', 'GS', 'V', 'MA', 'WMT', 'TGT', 'KO', 'PEP', 'NKE', 'MCD', 'DIS', 'LLY', 'JNJ', 'PFE', 'CAT', 'GE', 'BA', 'XOM', 'CVX', 'BRK-B', 'UNH', 'HD', 'PG', 'ABBV', 'MRK', 'T', 'VZ', 'NVO', 'AZN', 'NVS', 'TM', 'HSBC', 'BABA', 'SAP', 'HDB', 'IBN', 'INFY', 'WIT', 'BTI', 'DEO', 'BP', 'SHEL', 'UL'],
  LSE: ['BARC', 'HSBA', 'BP.L', 'SHEL.L', 'AZN.L', 'GSK.L', 'ULVR.L', 'DGE.L', 'VOD.L', 'LLOY.L', 'TSCO.L', 'RR.L', 'STAN.L', 'AAL.L', 'RIO.L', 'GLEN.L', 'REL.L', 'PRU.L', 'NG.L', 'BAES.L'],
  NSE: ['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS', 'HINDUNILVR.NS', 'ITC.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'LTIM.NS', 'LT.NS', 'KOTAKBANK.NS', 'AXISBANK.NS', 'ASIANPAINT.NS', 'MARUTI.NS', 'M&M.NS', 'TATASTEEL.NS', 'SUNPHARMA.NS', 'HCLTECH.NS', 'WIPRO.NS'],
  HKEX: ['0700.HK', '9988.HK', '3690.HK', '1299.HK', '0939.HK', '1398.HK', '2318.HK', '3988.HK', '0388.HK', '0005.HK', '0883.HK', '1088.HK', '1810.HK', '9618.HK', '2015.HK', '2331.HK', '1211.HK', '0941.HK', '1024.HK', '2018.HK'],
  ASX: ['BHP.AX', 'CBA.AX', 'CSL.AX', 'NAB.AX', 'WBC.AX', 'ANZ.AX', 'MQG.AX', 'WDS.AX', 'TLS.AX', 'FMG.AX', 'WES.AX', 'WOW.AX', 'RIO.AX', 'QAN.AX', 'ALL.AX', 'TCL.AX', 'GMG.AX', 'REA.AX', 'SEK.AX']
};

export class CatalogWorker {
  private timer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private catalogService: MarketCatalogService;
  private isCrawling: boolean = false;
  private isRefreshing: boolean = false;

  constructor() {
    this.catalogService = MarketCatalogService.getInstance();
  }

  public start(): void {
    Logger.info('[CATALOG WORKER] Starting background catalog crawlers and refresh loops...');

    // 1. Crawl Listings: Run every 45 seconds to seed global exchanges gradually
    this.timer = setInterval(() => this.crawlNextStep(), 45000);

    // 2. Metadata Refresh: Run every 60 minutes to batch update tickers that need refresh (>30 days old)
    this.refreshTimer = setInterval(() => this.runMetadataRefreshCycle(), 3600000);

    // Run first step immediately
    setTimeout(() => this.crawlNextStep(), 5000);
    setTimeout(() => this.runMetadataRefreshCycle(), 15000);
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    Logger.info('[CATALOG WORKER] Stopped background catalog workers.');
  }

  /**
   * Crawls the next ticker symbol in the pagination sequence across active global exchanges.
   */
  private async crawlNextStep(): Promise<void> {
    if (this.isCrawling) return;
    this.isCrawling = true;

    try {
      const exchangeList = Object.keys(CRAWL_SEQUENCES);

      for (const exId of exchangeList) {
        // Fetch or create the crawl state for this exchange
        let crawlState = await prisma.exchangeCrawlState.findUnique({
          where: { exchangeId: exId }
        });

        if (!crawlState) {
          crawlState = await prisma.exchangeCrawlState.create({
            data: { exchangeId: exId, lastOffset: 0, isCompleted: false }
          });
        }

        if (crawlState.isCompleted) {
          continue; // Move to the next exchange in sequence
        }

        const symbols = CRAWL_SEQUENCES[exId];
        const offset = crawlState.lastOffset;

        if (offset >= symbols.length) {
          // Completed this exchange crawl!
          await prisma.exchangeCrawlState.update({
            where: { exchangeId: exId },
            data: { isCompleted: true }
          });
          Logger.info(`[CATALOG CRAWLER] Completed import crawling for exchange: ${exId}`);
          continue;
        }

        const nextSymbol = symbols[offset];
        Logger.info(`[CATALOG CRAWLER] Importing ticker ${offset + 1}/${symbols.length} on ${exId}: ${nextSymbol}`);

        // Scrape and upsert metadata
        await this.catalogService.registerDynamicDiscovery(nextSymbol);

        // Advance crawl index offset
        await prisma.exchangeCrawlState.update({
          where: { exchangeId: exId },
          data: { lastOffset: offset + 1 }
        });

        // Break loop to throttle API requests
        break;
      }
    } catch (err) {
      Logger.error('[CATALOG CRAWLER] Error in step execution', err);
    } finally {
      this.isCrawling = false;
    }
  }

  /**
   * Refreshes metadata for tickers that haven't been updated in 30 days.
   */
  private async runMetadataRefreshCycle(): Promise<void> {
    if (this.isRefreshing) return;
    this.isRefreshing = true;

    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Find tickers that need metadata updates
      const outdatedTickers = await prisma.ticker.findMany({
        where: {
          lastMetadataUpdate: {
            lt: thirtyDaysAgo
          }
        },
        take: 10 // Throttle refresh to batches of 10
      });

      if (outdatedTickers.length > 0) {
        Logger.info(`[CATALOG REFRESHER] Found ${outdatedTickers.length} outdated tickers. Refreshing metadata...`);
        for (const tk of outdatedTickers) {
          await this.catalogService.refreshTickerMetadata(tk.id);
          // Wait 3 seconds between requests to avoid rate limit bans
          await new Promise((res) => setTimeout(res, 3000));
        }
      }
    } catch (err) {
      Logger.error('[CATALOG REFRESHER] Error running metadata refresh cycle', err);
    } finally {
      this.isRefreshing = false;
    }
  }
}
