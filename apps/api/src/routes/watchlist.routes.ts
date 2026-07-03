import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '@stock-market/database';
import { AppErrorCode } from '@stock-market/shared';
import { AppError } from '../middlewares/error.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Require authentication for all watchlist routes
router.use(authMiddleware);

// GET /api/v1/watchlist - Get all watchlisted symbols
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const items = await prisma.watchlistItem.findMany({
      where: { userId },
      include: {
        ticker: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      watchlist: items.map((i) => ({
        symbol: i.tickerId,
        name: i.ticker.name,
        sector: i.ticker.sector,
        exchange: i.ticker.exchangeId,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/watchlist - Add ticker to watchlist
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { symbol } = req.body;

    if (!symbol) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'Ticker symbol is required', 400);
    }

    const ticker = await prisma.ticker.findUnique({
      where: { id: symbol.toUpperCase() },
    });

    if (!ticker) {
      throw new AppError(AppErrorCode.BAD_REQUEST, `Symbol ${symbol} is not tradeable`, 404);
    }

    // Upsert to prevent duplicate unique constraint error
    const watchlistItem = await prisma.watchlistItem.upsert({
      where: {
        userId_tickerId: {
          userId,
          tickerId: ticker.id,
        },
      },
      update: {},
      create: {
        userId,
        tickerId: ticker.id,
      },
    });

    res.json({
      success: true,
      message: `${ticker.id} added to watchlist`,
      item: {
        symbol: watchlistItem.tickerId,
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/watchlist/:symbol - Remove ticker from watchlist
router.delete('/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const userId = req.user!.userId;

    await prisma.watchlistItem.delete({
      where: {
        userId_tickerId: {
          userId,
          tickerId: symbol,
        },
      },
    });

    res.json({
      success: true,
      message: `${symbol} removed from watchlist`,
    });
  } catch (error) {
    if ((error as any).code === 'P2025') {
      throw new AppError(AppErrorCode.BAD_REQUEST, `${symbol} was not on your watchlist`, 404);
    }
    next(error);
  }
});

export const watchlistRoutes = router;
export default watchlistRoutes;
