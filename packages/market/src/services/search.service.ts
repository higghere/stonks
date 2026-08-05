import { prisma } from '@stock-market/database';
import { ProviderManager } from './provider-manager';
import { marketEventBus, DomainEvent } from '@stock-market/shared';
import { Logger } from '@stock-market/logger';
import { DiscoveryReason } from '@prisma/client';

export class SearchService {
  private static instance: SearchService;
  private providerManager: ProviderManager;

  private constructor() {
    this.providerManager = ProviderManager.getInstance();
  }

  public static getInstance(): SearchService {
    if (!SearchService.instance) {
      SearchService.instance = new SearchService();
    }
    return SearchService.instance;
  }

  private calculateScore(ticker: { symbol: string; name: string }, query: string, isFromDb: boolean): number {
    const q = query.toUpperCase().trim();
    const sym = ticker.symbol.toUpperCase();
    const name = ticker.name.toUpperCase();

    let score = 0;
    
    // 1. Symbol Match Scoring
    if (sym === q) {
      score += 100;
    } else if (sym.startsWith(q)) {
      score += 80;
    } else if (sym.includes(q)) {
      score += 20;
    }

    // 2. Name Match Scoring
    if (name === q) {
      score += 60;
    } else if (name.startsWith(q)) {
      score += 40;
    } else if (name.includes(q)) {
      score += 20;
    }

    // 3. Database Exists Bonus
    if (isFromDb) {
      score += 10;
    }

    return score;
  }

  public async search(query: string, skip = 0, limit = 20): Promise<any[]> {
    const qClean = query.trim();
    if (!qClean) return [];

    try {
      // 1. Search locally in PostgreSQL database
      const localTickers = await prisma.ticker.findMany({
        where: {
          isActive: true,
          OR: [
            { id: { contains: qClean, mode: 'insensitive' } },
            { symbol: { contains: qClean, mode: 'insensitive' } },
            { name: { contains: qClean, mode: 'insensitive' } },
          ],
        },
        include: { exchange: true, asset: true },
      });

      // Map local tickers to unified format
      const localCandidates = localTickers.map((t) => ({
        id: t.id,
        symbol: t.symbol || t.id,
        name: t.name,
        exchange: t.exchangeId,
        assetType: t.asset?.assetType || t.assetType,
        isFromDb: true,
        source: t,
      }));

      // 2. Search using the ProviderManager
      let providerResults: any[] = [];
      try {
        providerResults = await this.providerManager.search(qClean);
      } catch (err) {
        Logger.error('[SEARCH SERVICE] Provider search failed', err);
      }

      const providerCandidates = providerResults.map((r) => ({
        id: r.ticker,
        symbol: r.ticker,
        name: r.name,
        exchange: r.exchange || 'NASDAQ',
        assetType: r.assetType || 'EQUITY',
        isFromDb: false,
      }));

      // 3. Merge & Deduplicate candidates
      const merged = [...localCandidates, ...providerCandidates];
      const seenIds = new Set<string>();
      const uniqueCandidates: any[] = [];

      for (const cand of merged) {
        const key = `${cand.exchange}:${cand.symbol}`.toUpperCase();
        if (!seenIds.has(key)) {
          seenIds.add(key);
          uniqueCandidates.push(cand);
        }
      }

      // 4. Rank candidates based on custom scoring
      const scoredCandidates = uniqueCandidates.map((cand) => {
        const score = this.calculateScore(cand, qClean, cand.isFromDb);
        return { ...cand, score };
      });

      // Sort by score DESC
      scoredCandidates.sort((a, b) => b.score - a.score);

      // Slice the top results immediately to respond to user fast
      const paginatedResults = scoredCandidates.slice(skip, skip + limit);

      // 5. Fire background Discovery events asynchronously for any non-DB symbols returned
      const nonDbSymbols = paginatedResults.filter((cand) => !cand.isFromDb);
      if (nonDbSymbols.length > 0) {
        process.nextTick(() => {
          for (const cand of nonDbSymbols) {
            marketEventBus.emit(DomainEvent.ASSET_DISCOVERED, {
              symbol: cand.symbol,
              name: cand.name,
              exchangeId: cand.exchange,
              reason: DiscoveryReason.SEARCH,
              priority: 100,
            });
          }
        });
      }

      // Format results for the front-end (backwards-compatible with Ticker model)
      return paginatedResults.map((cand) => {
        if (cand.isFromDb) {
          return cand.source;
        } else {
          return {
            id: cand.id,
            symbol: cand.symbol,
            name: cand.name,
            assetType: cand.assetType,
            exchangeId: cand.exchange,
            isActive: true,
            isVerified: false,
            sector: null,
            industry: null,
            currency: 'USD',
            country: null,
          };
        }
      });
    } catch (err) {
      Logger.error('[SEARCH SERVICE] Hybrid search failed', err);
      throw err;
    }
  }
}
export default SearchService;
