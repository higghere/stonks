import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { MatchingEngine } from '@stock-market/orders';
import { prisma } from '@stock-market/database';
import { AppErrorCode, OrderSide, OrderType } from '@stock-market/shared';
import { AppError } from '../middlewares/error.middleware';
import { authMiddleware } from '../middlewares/auth.middleware';
import { orderLimiter } from '../middlewares/rate-limit.middleware';

const router = Router();
const matchingEngine = MatchingEngine.getInstance();

const orderSchema = z.object({
  tickerId: z.string().min(1, 'Ticker symbol is required'),
  side: z.enum([OrderSide.BUY, OrderSide.SELL]),
  type: z.enum([OrderType.MARKET, OrderType.LIMIT, OrderType.STOP]),
  quantity: z.number().positive('Quantity must be greater than zero'),
  price: z.number().positive('Price must be positive').optional(),
  stopPrice: z.number().positive('Stop price must be positive').optional(),
});

// Apply auth middleware globally to all order routes
router.use(authMiddleware);

// POST /api/v1/orders - Place an order (requires Idempotency-Key)
router.post('/', orderLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] as string;
    if (!idempotencyKey) {
      throw new AppError(AppErrorCode.IDEMPOTENCY_KEY_MISSING, 'Header "Idempotency-Key" is required for placing orders', 400);
    }

    const { tickerId, side, type, quantity, price, stopPrice } = orderSchema.parse(req.body);

    // Find the user's trading account
    const account = await prisma.account.findUnique({
      where: { userId: req.user!.userId },
    });
    if (!account) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'No paper trading account found for this user', 404);
    }

    const result = await matchingEngine.submitOrder(
      account.id,
      tickerId,
      side,
      type,
      quantity,
      price,
      stopPrice,
      idempotencyKey
    );

    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error: any) {
    if (error.code) {
      next(error); // ValidationError
    } else {
      next(new AppError(AppErrorCode.BAD_REQUEST, error.message || 'Failed to place order', 400));
    }
  }
});

// GET /api/v1/orders - View user's order lists
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const account = await prisma.account.findUnique({
      where: { userId: req.user!.userId },
    });
    if (!account) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'No trading account found', 404);
    }

    const status = req.query.status as string;

    const orders = await prisma.order.findMany({
      where: {
        accountId: account.id,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { executions: true },
    });

    res.json({
      success: true,
      orders,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/orders/:id - Get details of a single order
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const account = await prisma.account.findUnique({
      where: { userId: req.user!.userId },
    });
    if (!account) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'No trading account found', 404);
    }

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { executions: true },
    });

    if (!order || order.accountId !== account.id) {
      throw new AppError(AppErrorCode.BAD_REQUEST, 'Order not found', 404);
    }

    res.json({
      success: true,
      order,
    });
  } catch (error) {
    next(error);
  }
});

export const orderRoutes = router;
export default orderRoutes;
