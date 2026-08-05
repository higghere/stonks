import { prisma } from '@stock-market/database';
import { Logger } from '@stock-market/logger';
import { ProviderManager } from '@stock-market/market';
import { marketEventBus, DomainEvent } from '@stock-market/shared';
import {
  DiscoveryStatus,
  QueueStatus,
  ProviderSource,
  DiscoveryReason,
  AssetType,
} from '@prisma/client';

export class AssetRegistry {
  private static instance: AssetRegistry;
  private providerManager: ProviderManager;
  private pendingDiscovery = new Set<string>();
  private pendingEnrichment = new Set<string>();

  private constructor() {
    this.providerManager = ProviderManager.getInstance();
    this.setupEventListeners();
  }

  public static getInstance(): AssetRegistry {
    if (!AssetRegistry.instance) {
      AssetRegistry.instance = new AssetRegistry();
    }
    return AssetRegistry.instance;
  }

  private setupEventListeners(): void {
    marketEventBus.on(DomainEvent.ASSET_DISCOVERED, async (payload: {
      symbol: string;
      name?: string;
      exchangeId?: string;
      reason: DiscoveryReason;
      priority: number;
    }) => {
      try {
        await this.enqueueDiscovery(payload);
      } catch (err) {
        Logger.error(`[ASSET REGISTRY] Failed to process ASSET_DISCOVERED event for ${payload.symbol}`, err);
      }
    });

    marketEventBus.on(DomainEvent.TICKER_CREATED, async (payload: { symbol: string }) => {
      try {
        await this.enqueueEnrichment(payload.symbol);
      } catch (err) {
        Logger.error(`[ASSET REGISTRY] Failed to process TICKER_CREATED event for ${payload.symbol}`, err);
      }
    });
  }

  public async enqueueDiscovery(payload: {
    symbol: string;
    name?: string;
    exchangeId?: string;
    reason: DiscoveryReason;
    priority: number;
  }): Promise<void> {
    const sym = payload.symbol.toUpperCase().trim();
    if (this.pendingDiscovery.has(sym)) return;

    const existing = await prisma.ticker.findUnique({
      where: { id: sym },
    });
    if (existing) return;

    this.pendingDiscovery.add(sym);

    try {
      await prisma.discoveryQueue.upsert({
        where: { symbol: sym },
        update: {
          priority: payload.priority,
          reason: payload.reason,
          status: QueueStatus.PENDING,
          nextAttempt: new Date(),
        },
        create: {
          symbol: sym,
          name: payload.name || null,
          exchangeId: payload.exchangeId || null,
          provider: ProviderSource.YAHOO,
          reason: payload.reason,
          priority: payload.priority,
        },
      });
      Logger.info(`[ASSET REGISTRY] Successfully enqueued discovery for: ${sym} (Reason: ${payload.reason})`);
    } catch (err) {
      Logger.error(`[ASSET REGISTRY] Failed to enqueue discovery for: ${sym}`, err);
    } finally {
      this.pendingDiscovery.delete(sym);
    }
  }

  public async enqueueEnrichment(symbol: string): Promise<void> {
    const sym = symbol.toUpperCase().trim();
    if (this.pendingEnrichment.has(sym)) return;

    this.pendingEnrichment.add(sym);

    try {
      await prisma.enrichmentQueue.upsert({
        where: { symbol: sym },
        update: {
          status: QueueStatus.PENDING,
          nextAttempt: new Date(),
        },
        create: {
          symbol: sym,
          priority: 50,
        },
      });
      Logger.info(`[ASSET REGISTRY] Successfully enqueued enrichment for: ${sym}`);
    } catch (err) {
      Logger.error(`[ASSET REGISTRY] Failed to enqueue enrichment for: ${sym}`, err);
    } finally {
      this.pendingEnrichment.delete(sym);
    }
  }

  public async registerDiscoveredShort(symbol: string, name?: string, exchangeId?: string): Promise<any> {
    const sym = symbol.toUpperCase().trim();
    const exId = exchangeId || 'NASDAQ';
    const finalName = name || `${sym} Corp.`;

    try {
      const existing = await prisma.ticker.findUnique({
        where: { id: sym },
        include: { asset: true },
      });
      if (existing) {
        return existing;
      }

      await prisma.exchange.upsert({
        where: { id: exId },
        update: {},
        create: {
          id: exId,
          name: `${exId} Stock Exchange`,
          country: 'US',
          timezone: 'America/New_York',
          openingTime: '09:30',
          closingTime: '16:00',
          currency: 'USD',
        },
      });

      const asset = await prisma.asset.create({
        data: {
          name: finalName,
          assetType: AssetType.EQUITY,
          status: DiscoveryStatus.DISCOVERED,
          provider: ProviderSource.YAHOO,
        },
      });

      const ticker = await prisma.ticker.create({
        data: {
          id: sym,
          symbol: sym,
          name: finalName,
          assetType: 'STOCK',
          exchangeId: exId,
          assetId: asset.id,
          currency: 'USD',
          isActive: true,
          providerSymbol: sym,
        },
      });

      Logger.info(`[ASSET REGISTRY] Registered minimal DISCOVERED ticker: ${sym} (${finalName})`);
      marketEventBus.emit(DomainEvent.TICKER_CREATED, { symbol: sym });
      return ticker;
    } catch (err: any) {
      if (err.code === 'P2002') {
        const existing = await prisma.ticker.findUnique({
          where: { id: sym },
          include: { asset: true },
        });
        if (existing) return existing;
      }
      Logger.error(`[ASSET REGISTRY] Failed to register minimal discovery ticker: ${sym}`, err);
      throw err;
    }
  }

  public async enrichAsset(symbol: string): Promise<void> {
    const sym = symbol.toUpperCase().trim();

    try {
      const ticker = await prisma.ticker.findUnique({
        where: { id: sym },
        include: { asset: true },
      });

      if (!ticker || !ticker.asset) {
        throw new Error(`Ticker ${sym} or its associated Asset not found in database.`);
      }

      Logger.info(`[ASSET REGISTRY] Enriching metadata for: ${sym}`);
      const profile = await this.providerManager.getActiveProviders()[0].getCompanyProfile(sym);

      const oldName = ticker.asset.name;
      const oldSector = ticker.asset.sector;
      const oldIndustry = ticker.asset.industry;

      const hasChanges =
        oldName !== profile.name ||
        oldSector !== profile.sector ||
        oldIndustry !== profile.industry;

      await prisma.$transaction(async (tx) => {
        await tx.asset.update({
          where: { id: ticker.asset!.id },
          data: {
            name: profile.name,
            sector: profile.sector,
            industry: profile.industry,
            country: profile.country,
            status: DiscoveryStatus.VERIFIED,
            lastVerifiedAt: new Date(),
            lastMetadataUpdate: new Date(),
          },
        });

        await tx.ticker.update({
          where: { id: sym },
          data: {
            name: profile.name,
            sector: profile.sector,
            industry: profile.industry,
            country: profile.country,
            currency: profile.currency || 'USD',
            isVerified: true,
            lastMetadataUpdate: new Date(),
          },
        });

        if (hasChanges) {
          await tx.assetMetadataHistory.create({
            data: {
              assetId: ticker.asset!.id,
              name: oldName,
              sector: oldSector,
              industry: oldIndustry,
              effectiveTo: new Date(),
            },
          });
        }
      });

      Logger.info(`[ASSET REGISTRY] Successfully enriched and VERIFIED ticker: ${sym}`);
      marketEventBus.emit(DomainEvent.TICKER_VERIFIED, { symbol: sym });
    } catch (err) {
      Logger.error(`[ASSET REGISTRY] Failed to enrich ticker: ${sym}`, err);
      throw err;
    }
  }
}
export default AssetRegistry;
