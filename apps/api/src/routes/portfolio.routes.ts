import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '@stock-market/database';
import { PortfolioService } from '@stock-market/portfolio';
import { AppErrorCode } from '@stock-market/shared';
import { AppError } from '../middlewares/error.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();
const portfolioService = PortfolioService.getInstance();

// Apply authentication globally to all portfolio routes
router.use(authMiddleware);

// GET /api/v1/portfolio - Get current holdings and cash balance
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const valuation = await portfolioService.getPortfolioValuation(userId);

    res.json({
      success: true,
      data: {
        account: {
          id: valuation.account.id,
          cashBalance: valuation.account.cashBalance,
          totalMarketValue: valuation.account.totalHoldingsValue,
          totalPortfolioValue: valuation.account.netAssetValue,
        },
        positions: valuation.positions,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/portfolio/history - Get historical snapshots for performance graphs
router.get('/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const account = await prisma.account.findUnique({
      where: { userId },
    });

    if (!account) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'No trading account found for this user', 404);
    }

    // Fetch snapshots for this account
    const snapshots = await prisma.portfolioSnapshot.findMany({
      where: { accountId: account.id },
      orderBy: { snapshotDate: 'asc' },
      take: 30, // Limit to last 30 days
    });

    // UX Fallback: If no nightly snapshots exist yet, construct a flatline from account creation
    if (snapshots.length === 0) {
      const createdDate = account.createdAt.toISOString().split('T')[0];
      const todayDate = new Date().toISOString().split('T')[0];
      const startingValue = Number(account.cashBalance);

      return res.json({
        success: true,
        history: [
          { date: createdDate, totalValue: startingValue, cash: startingValue },
          { date: todayDate, totalValue: startingValue, cash: startingValue },
        ],
      });
    }

    res.json({
      success: true,
      history: snapshots.map((s) => ({
        date: s.snapshotDate.toISOString().split('T')[0],
        totalValue: Number(s.totalValue),
        cash: Number(s.cash),
      })),
    });
  } catch (error) {
    next(error);
  }
});

export const portfolioRoutes = router;
export default portfolioRoutes;
