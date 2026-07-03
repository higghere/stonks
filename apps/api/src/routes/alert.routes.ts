import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '@stock-market/database';
import { Decimal } from '@prisma/client/runtime/library';
import { AppErrorCode } from '@stock-market/shared';
import { AppError } from '../middlewares/error.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Require authentication for all alerts routes
router.use(authMiddleware);

// GET /api/v1/alerts - Get user's price alerts
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const alerts = await prisma.alert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      alerts: alerts.map((a) => ({
        id: a.id,
        symbol: a.tickerId,
        type: a.type,
        condition: a.condition,
        value: Number(a.value),
        isTriggered: a.isTriggered,
        createdAt: a.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/alerts - Create a new alert
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { symbol, type, condition, value } = req.body;

    if (!symbol || !type || !condition || value === undefined) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'Missing required parameters: symbol, type, condition, value', 400);
    }

    if (type !== 'PRICE' && type !== 'VOLUME') {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'Alert type must be "PRICE" or "VOLUME"', 400);
    }

    if (condition !== 'ABOVE' && condition !== 'BELOW') {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'Condition must be "ABOVE" or "BELOW"', 400);
    }

    const numValue = Number(value);
    if (isNaN(numValue) || numValue <= 0) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'Alert trigger value must be a positive number', 400);
    }

    const ticker = await prisma.ticker.findUnique({
      where: { id: symbol.toUpperCase() },
    });

    if (!ticker) {
      throw new AppError(AppErrorCode.BAD_REQUEST, `Symbol ${symbol} is not tradeable`, 404);
    }

    const alert = await prisma.alert.create({
      data: {
        userId,
        tickerId: ticker.id,
        type,
        condition,
        value: new Decimal(numValue),
      },
    });

    res.json({
      success: true,
      alert: {
        id: alert.id,
        symbol: alert.tickerId,
        type: alert.type,
        condition: alert.condition,
        value: Number(alert.value),
        isTriggered: alert.isTriggered,
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/alerts/:id - Delete an alert
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const alert = await prisma.alert.findUnique({
      where: { id },
    });

    if (!alert || alert.userId !== userId) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'Alert not found or unauthorized', 404);
    }

    await prisma.alert.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Alert rule deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

export const alertRoutes = router;
export default alertRoutes;
