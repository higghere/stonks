import { prisma } from '@stock-market/database';
import { MarketService } from '@stock-market/market';
import { Logger } from '@stock-market/logger';

export interface PositionValuation {
  tickerId: string;
  name: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPl: number;
  unrealizedPlPercent: number;
  isShort?: boolean;
  marginCallPrice?: number;
}

export interface PortfolioValuation {
  account: {
    id: string;
    cashBalance: number;
    totalHoldingsValue: number;
    netAssetValue: number;
    marginCallActive?: boolean;
    marginCallDeadline?: Date;
  };
  positions: PositionValuation[];
}

export class PortfolioService {
  private static instance: PortfolioService;
  private marketService = MarketService.getInstance();

  private constructor() {}

  public static getInstance(): PortfolioService {
    if (!PortfolioService.instance) {
      PortfolioService.instance = new PortfolioService();
    }
    return PortfolioService.instance;
  }

  public async getExchangeRate(fromCurrency: string, toCurrency: string): Promise<number> {
    const from = fromCurrency.toUpperCase().trim();
    const to = toCurrency.toUpperCase().trim();

    if (from === to) return 1.0;

    const ticker1 = `${from}${to}=X`;
    try {
      const quote = await this.marketService.getQuote(ticker1);
      if (quote && quote.price > 0) {
        return quote.price;
      }
    } catch {
      const ticker2 = `${to}${from}=X`;
      try {
        const quote = await this.marketService.getQuote(ticker2);
        if (quote && quote.price > 0) {
          return 1.0 / quote.price;
        }
      } catch {
        // Fall back
      }
    }

    const usdRates: Record<string, number> = {
      USD: 1.0,
      EUR: 1.08,
      GBP: 1.28,
      JPY: 0.0065,
      CAD: 0.73,
      AUD: 0.66,
      CHF: 1.12,
      CNY: 0.14,
      INR: 0.012,
    };

    const fromRate = usdRates[from];
    const toRate = usdRates[to];

    if (fromRate && toRate) {
      return fromRate / toRate;
    }

    return 1.0;
  }

  /**
   * Calculates the real-time NAV, holdings market value, and unrealized profit/loss for a user
   */
  public async getPortfolioValuation(userId: string): Promise<PortfolioValuation> {
    // 1. Fetch user account
    const account = await prisma.account.findUnique({
      where: { userId },
      include: {
        positions: {
          include: {
            ticker: true,
          },
        },
      },
    });

    if (!account) {
      throw new Error(`Account not found for user: ${userId}`);
    }

    const cash = Number(account.cashBalance);
    const positionValuations: PositionValuation[] = [];
    let totalHoldingsValue = 0;

    // Batch query quotes for all positions to optimize performance
    const tickerIds = account.positions.map(p => p.tickerId);
    let quotesMap: Record<string, any> = {};
    try {
      quotesMap = await this.marketService.getQuotes(tickerIds);
    } catch (err) {
      Logger.error('Failed to batch query quotes in getPortfolioValuation', err);
    }

    // 2. Calculate valuations with FX conversions and short selling metrics
    for (const pos of account.positions) {
      const qty = Number(pos.quantity);
      if (qty <= 0) continue;

      const baseCurrency = account.baseCurrency || 'USD';
      const tickerCurrency = 'USD';

      try {
        const quote = quotesMap[pos.tickerId] || await this.marketService.getQuote(pos.tickerId);
        const currentPrice = quote.price;
        const avgPrice = Number(pos.averagePrice);

        // Get FX rate to convert this position's native metrics to account base currency
        const fxRate = await this.getExchangeRate(tickerCurrency, baseCurrency);

        // Market value and Unrealized Pl in native currency
        const marketValueNative = pos.isShort ? -qty * currentPrice : qty * currentPrice;
        const unrealizedPlNative = pos.isShort 
          ? (avgPrice - currentPrice) * qty 
          : (currentPrice - avgPrice) * qty;

        // Convert to base currency
        const marketValueBase = marketValueNative * fxRate;
        const unrealizedPlBase = unrealizedPlNative * fxRate;

        const unrealizedPlPercent = avgPrice > 0 
          ? (unrealizedPlNative / (avgPrice * qty)) * 100 
          : 0;

        totalHoldingsValue += marketValueBase;

        positionValuations.push({
          tickerId: pos.tickerId,
          name: pos.ticker.name,
          quantity: qty,
          averagePrice: avgPrice,
          currentPrice,
          marketValue: parseFloat(marketValueBase.toFixed(2)),
          unrealizedPl: parseFloat(unrealizedPlBase.toFixed(2)),
          unrealizedPlPercent: parseFloat(unrealizedPlPercent.toFixed(2)),
          isShort: pos.isShort,
          marginCallPrice: pos.marginCallPrice ? Number(pos.marginCallPrice) : undefined,
        });
      } catch (err) {
        Logger.error(`Failed to value holding ${pos.tickerId} for account ${account.id}`, err);
        const avgPrice = Number(pos.averagePrice);
        const fxRate = await this.getExchangeRate(tickerCurrency, baseCurrency);

        const marketValueNative = pos.isShort ? -qty * avgPrice : qty * avgPrice;
        const marketValueBase = marketValueNative * fxRate;

        totalHoldingsValue += marketValueBase;

        positionValuations.push({
          tickerId: pos.tickerId,
          name: pos.ticker.name,
          quantity: qty,
          averagePrice: avgPrice,
          currentPrice: avgPrice,
          marketValue: parseFloat(marketValueBase.toFixed(2)),
          unrealizedPl: 0,
          unrealizedPlPercent: 0,
          isShort: pos.isShort,
          marginCallPrice: pos.marginCallPrice ? Number(pos.marginCallPrice) : undefined,
        });
      }
    }

    return {
      account: {
        id: account.id,
        cashBalance: cash,
        totalHoldingsValue: parseFloat(totalHoldingsValue.toFixed(2)),
        netAssetValue: parseFloat((cash + totalHoldingsValue).toFixed(2)),
        marginCallActive: account.marginCallActive,
        marginCallDeadline: account.marginCallDeadline || undefined,
      },
      positions: positionValuations,
    };
  }

  /**
   * Recreates the historical positions and cash balance for an account up to a past date
   */
  public async getHistoryReplay(userId: string, upToDate: Date) {
    const account = await prisma.account.findUnique({
      where: { userId },
    });

    if (!account) {
      throw new Error(`Account not found for user: ${userId}`);
    }

    // Fetch all transaction entries up to target timestamp
    const entries = await prisma.transactionEntry.findMany({
      where: {
        accountId: account.id,
        createdAt: { lte: upToDate },
      },
      orderBy: { createdAt: 'asc' },
    });

    let cashBalance = 0;
    const positions = new Map<string, { quantity: number; averagePrice: number }>();

    // Replay chronological ledger double-entries
    for (const entry of entries) {
      const amount = Number(entry.amount);

      if (entry.assetType === 'CASH') {
        cashBalance += amount;
      } else if (entry.assetType === 'TICKER' && entry.tickerId) {
        const ticker = entry.tickerId;
        const pos = positions.get(ticker) || { quantity: 0, averagePrice: 0 };
        const price = Number(entry.price || 0);

        if (amount > 0) {
          // Buying shares: recompute average entry price
          const newQty = pos.quantity + amount;
          const newAvgPrice = ((pos.quantity * pos.averagePrice) + (amount * price)) / newQty;
          pos.quantity = newQty;
          pos.averagePrice = newAvgPrice;
        } else if (amount < 0) {
          // Selling shares
          const newQty = pos.quantity + amount; // amount is negative
          pos.quantity = newQty;
          if (newQty <= 0) {
            pos.quantity = 0;
            pos.averagePrice = 0;
          }
        }
        positions.set(ticker, pos);
      }
    }

    // Convert positions map to array
    const activeHoldings = Array.from(positions.entries())
      .filter(([_, p]) => p.quantity > 0)
      .map(([tickerId, p]) => ({
        tickerId,
        quantity: p.quantity,
        averagePrice: p.averagePrice,
      }));

    return {
      accountId: account.id,
      timestamp: upToDate,
      cashBalance,
      positions: activeHoldings,
    };
  }

  /**
   * Fallback engine to rebuild the Position table projections from transactional entries
   */
  public async rebuildPositionsProjection(accountId: string): Promise<void> {
    Logger.info(`Rebuilding positions projection for account: ${accountId}`);

    const entries = await prisma.transactionEntry.findMany({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
    });

    const positionsMap = new Map<string, { quantity: number; averagePrice: number }>();

    for (const entry of entries) {
      if (entry.assetType !== 'TICKER' || !entry.tickerId) continue;
      const ticker = entry.tickerId;
      const amount = Number(entry.amount);
      const price = Number(entry.price || 0);

      const pos = positionsMap.get(ticker) || { quantity: 0, averagePrice: 0 };

      if (amount > 0) {
        const newQty = pos.quantity + amount;
        const newAvg = ((pos.quantity * pos.averagePrice) + (amount * price)) / newQty;
        pos.quantity = newQty;
        pos.averagePrice = newAvg;
      } else if (amount < 0) {
        const newQty = pos.quantity + amount;
        pos.quantity = newQty;
        if (newQty <= 0) {
          pos.quantity = 0;
          pos.averagePrice = 0;
        }
      }
      positionsMap.set(ticker, pos);
    }

    // Perform database atomic update
    await prisma.$transaction(async (tx) => {
      // Clear existing position listings
      await tx.position.deleteMany({
        where: { accountId },
      });

      // Insert rebuilt non-empty positions
      for (const [tickerId, pos] of positionsMap.entries()) {
        if (pos.quantity <= 0) continue;
        await tx.position.create({
          data: {
            accountId,
            tickerId,
            quantity: pos.quantity,
            averagePrice: pos.averagePrice,
          },
        });
      }
    });

    Logger.info(`Positions projection rebuild complete for account: ${accountId}`);
  }
}
