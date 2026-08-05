import { Router, Request, Response } from 'express';
import { PrismaClient } from '@stock-market/database';
import { MarketService } from '@stock-market/market';
import { Logger } from '@stock-market/logger';
import http from 'http';

const router = Router();
const prisma = new PrismaClient();
const logger = new Logger('PredictionRoutes');
const marketService = MarketService.getInstance();

const PREDICTION_SERVICE_URL = process.env.PREDICTION_SERVICE_URL || 'http://127.0.0.1:8000';
const CACHE_TTL_MS = 86400 * 1000; // 24 hours
const memoryCache = new Map<string, { data: any; expiry: number }>();

/**
 * Helper to proxy HTTP GET request to Python prediction microservice
 */
function fetchPythonPrediction(symbol: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `${PREDICTION_SERVICE_URL}/predict/${encodeURIComponent(symbol)}`;
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON response from prediction microservice.'));
          }
        } else {
          reject(new Error(`Prediction microservice returned HTTP status ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * GET /api/v1/predictions/stocks
 * Search & paginated directory of platform stocks (Zero ML compute)
 */
router.get('/stocks', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const query = (req.query.q as string || '').trim().toLowerCase();
    const sector = (req.query.sector as string || '').trim();
    const country = (req.query.country as string || '').trim();
    const exchange = (req.query.exchange as string || '').trim();

    const where: any = {};
    if (query) {
      where.OR = [
        { symbol: { contains: query, mode: 'insensitive' } },
        { name: { contains: query, mode: 'insensitive' } },
      ];
    }
    if (sector) where.sector = { equals: sector, mode: 'insensitive' };
    if (country) where.country = { equals: country, mode: 'insensitive' };
    if (exchange) where.exchange = { equals: exchange, mode: 'insensitive' };

    const [total, tickers] = await Promise.all([
      prisma.ticker.count({ where }),
      prisma.ticker.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { symbol: 'asc' },
      }),
    ]);

    const symbols = tickers.map((t: any) => t.id || t.symbol);
    const quotesMap: Record<string, any> = await marketService.getQuotes(symbols).catch(() => ({}));

    const formattedStocks = tickers.map((t: any) => {
      const sym = t.id || t.symbol;
      const liveQuote = quotesMap[sym];
      const price = liveQuote?.price || t.currentPrice || 100.0;
      const change = liveQuote?.changePercent || t.dayChangePercent || 0.0;

      return {
        ticker: sym,
        name: t.name,
        exchange: t.exchange || 'GLOBAL',
        sector: t.sector || 'General',
        country: t.country || 'USA',
        currentPrice: price,
        changePercent: change,
      };
    });

    return res.json({
      success: true,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stocks: formattedStocks,
    });
  } catch (error: any) {
    logger.error('Error fetching prediction stocks directory', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/predictions/:symbol
 * On-demand single ticker prediction (Checks Redis cache -> Proxies to Python microservice)
 */
router.get('/:symbol', async (req: Request, res: Response) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const forceRefresh = req.query.force === 'true';
    const cacheKey = `pred:cache:${symbol}`;

    // Check memory cache unless force refresh is requested
    if (!forceRefresh) {
      const cached = memoryCache.get(symbol);
      if (cached && cached.expiry > Date.now()) {
        return res.json({ success: true, source: 'cache', data: cached.data });
      }
    }

    // Proxy request to Python prediction microservice
    const predictionData = await fetchPythonPrediction(symbol);

    // Save result to cache
    memoryCache.set(symbol, { data: predictionData, expiry: Date.now() + CACHE_TTL_MS });

    return res.json({
      success: true,
      source: 'inference',
      data: predictionData,
    });
  } catch (error: any) {
    logger.error(`Error fetching prediction for ${req.params.symbol}`, error);
    return res.status(500).json({
      success: false,
      error: `Failed to generate on-demand prediction: ${error.message}`,
    });
  }
});

/**
 * POST /api/v1/predictions/:symbol/refresh
 * Forces cache invalidation and fresh prediction inference
 */
router.post('/:symbol/refresh', async (req: Request, res: Response) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    memoryCache.delete(symbol);
    const predictionData = await fetchPythonPrediction(symbol);
    memoryCache.set(symbol, { data: predictionData, expiry: Date.now() + CACHE_TTL_MS });

    return res.json({
      success: true,
      source: 'inference_refreshed',
      data: predictionData,
    });
  } catch (error: any) {
    logger.error(`Error refreshing prediction for ${req.params.symbol}`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
