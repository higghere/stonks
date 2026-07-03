import { Router, Request, Response, NextFunction } from 'express';
import { MarketService } from '@stock-market/market';
import { ExchangeService } from '@stock-market/market';
import { prisma } from '@stock-market/database';
import { AppErrorCode } from '@stock-market/shared';
import { AppError } from '../middlewares/error.middleware';
import { MarketCatalogService } from '@stock-market/market-catalog';
import { searchLimiter, quoteLimiter } from '../middlewares/rate-limit.middleware';

const router = Router();
const marketService = MarketService.getInstance();
const exchangeService = ExchangeService.getInstance();

// GET /api/v1/market/search
router.get('/search', searchLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'Search query parameter "q" is required', 400);
    }

    const results = await marketService.searchTickers(query);
    res.json({
      success: true,
      results,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/market/stock/:ticker
router.get('/stock/:ticker', quoteLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticker = req.params.ticker.toUpperCase().trim();
    
    // Fetch profile first to get the exchange ID
    const profile = await marketService.getCompanyProfile(ticker);
    
    // Fetch quote and session concurrently
    const [quote, session] = await Promise.all([
      marketService.getQuote(ticker),
      exchangeService.getSessionInfo(profile.exchange),
    ]);

    res.json({
      success: true,
      data: {
        profile,
        quote,
        session,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/market/history/:ticker
router.get('/history/:ticker', quoteLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ticker = req.params.ticker.toUpperCase().trim();
    const resolution = (req.query.resolution as string) || '1d';
    const from = parseInt(req.query.from as string, 10);
    const to = parseInt(req.query.to as string, 10);

    if (isNaN(from) || isNaN(to)) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'Valid "from" and "to" timestamps in seconds are required', 400);
    }

    const history = await marketService.getHistory(ticker, resolution, from, to);
    
    res.json({
      success: true,
      history,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/market/tickers
router.get('/tickers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = req.query.q as string;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const skip = (page - 1) * limit;
    
    let tickersList;

    if (query && query.trim().length > 0) {
      const qClean = query.trim();
      // 1. Search locally in PostgreSQL Ticker first
      const localTickers = await prisma.ticker.findMany({
        where: {
          isActive: true,
          OR: [
            { id: { contains: qClean, mode: 'insensitive' } },
            { name: { contains: qClean, mode: 'insensitive' } },
          ],
        },
        include: { exchange: true },
        skip,
        take: limit,
      });

      if (localTickers.length > 0) {
        tickersList = localTickers;
      } else {
        // 2. Query provider (YahooFinance autocomplete)
        const searchResults = await marketService.searchTickers(qClean);
        const upsertedTickers = [];
        for (const res of searchResults) {
          try {
            const t = await MarketCatalogService.getInstance().registerDynamicDiscovery(res.ticker);
            upsertedTickers.push(t);
          } catch (err) {
            console.error(`Failed to register discovery ticker ${res.ticker}:`, err);
          }
        }
        // Slice the results according to pagination
        tickersList = upsertedTickers.slice(skip, skip + limit);
      }
    } else {
      // Return standard database listings ordered by verified popularity
      tickersList = await prisma.ticker.findMany({
        where: { isActive: true },
        include: { exchange: true },
        orderBy: { id: 'asc' },
        skip,
        take: limit,
      });
    }

    const enrichedTickers = await Promise.all(
      tickersList.map(async (t) => {
        try {
          const quote = await marketService.getQuote(t.id);
          return {
            id: t.id,
            name: t.name,
            assetType: t.assetType,
            exchangeId: t.exchangeId,
            sector: t.sector,
            industry: t.industry,
            currency: t.currency,
            price: quote.price,
            change: quote.change,
            changePercent: quote.changePercent,
          };
        } catch {
          return {
            id: t.id,
            name: t.name,
            assetType: t.assetType,
            exchangeId: t.exchangeId,
            sector: t.sector,
            industry: t.industry,
            currency: t.currency,
            price: 0,
            change: 0,
            changePercent: 0,
          };
        }
      })
    );

    res.json({
      success: true,
      tickers: enrichedTickers,
    });
  } catch (error) {
    next(error);
  }
});

export const marketRoutes = router;
export default marketRoutes;
