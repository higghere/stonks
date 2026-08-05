import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { ConfigService } from '@stock-market/config';
import { Logger } from '@stock-market/logger';
import { prisma } from '@stock-market/database';
import { initWorkers } from '@stock-market/workers';
import { NotificationService } from '@stock-market/notifications';
import { QuoteService, QuoteInterestService } from '@stock-market/market';
import { marketEventBus, DomainEvent } from '@stock-market/shared';
import { authRoutes } from './routes/auth.routes';
import { marketRoutes } from './routes/market.routes';
import { orderRoutes } from './routes/order.routes';
import { portfolioRoutes } from './routes/portfolio.routes';
import { watchlistRoutes } from './routes/watchlist.routes';
import { alertRoutes } from './routes/alert.routes';
import { simulationRoutes } from './routes/simulation.routes';
import predictionRoutes from './routes/prediction.routes';
import { errorMiddleware } from './middlewares/error.middleware';
import { generalLimiter } from './middlewares/rate-limit.middleware';

const config = ConfigService.getInstance();
const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: '*', // Customize this in production
    methods: ['GET', 'POST'],
  },
});

// Redis client setup
const redisClient = createClient({
  url: config.get('REDIS_URL'),
});

redisClient.on('error', (err) => Logger.error('Redis client error', err));
redisClient.on('connect', () => Logger.info('Connected to Redis'));

const redisSubscriber = redisClient.duplicate();
redisSubscriber.on('error', (err) => Logger.error('Redis subscriber client error', err));
redisSubscriber.on('connect', () => Logger.info('Connected to Redis Subscriber'));

// Cookie Parser Middleware (Manual - lightweight)
app.use((req, res, next) => {
  const cookieStr = req.headers.cookie;
  req.cookies = {};
  if (cookieStr) {
    req.cookies = Object.fromEntries(
      cookieStr.split(';').map((c) => {
        const parts = c.trim().split('=');
        return [parts[0], parts.slice(1).join('=')];
      })
    );
  }
  next();
});

// Apply Global Middlewares
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);

// Simple Request Logging Middleware
app.use((req, res, next) => {
  Logger.api(`${req.method} ${req.path}`);
  next();
});

// Mounted Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/market', marketRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/portfolio', portfolioRoutes);
app.use('/api/v1/watchlist', watchlistRoutes);
app.use('/api/v1/alerts', alertRoutes);
app.use('/api/v1/simulation', simulationRoutes);
app.use('/api/v1/predictions', predictionRoutes);

// Welcome Endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to the Stock Market Paper Trading API Gateway',
    version: 'v1',
    status: 'active'
  });
});

// Mock devtools json to avoid 404 console errors from Chrome
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.json({});
});

// Health Check Endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/ready', async (req, res) => {
  const checks: Record<string, string> = {
    database: 'failed',
    redis: 'failed',
  };

  try {
    // 1. Check database
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'connected';
  } catch (err) {
    Logger.error('Ready check: DB connection check failed', err);
  }

  try {
    // 2. Check Redis
    if (redisClient.isOpen) {
      await redisClient.ping();
      checks.redis = 'connected';
    }
  } catch (err) {
    Logger.error('Ready check: Redis check failed', err);
  }

  const isReady = Object.values(checks).every((status) => status === 'connected');
  
  if (isReady) {
    res.json({ status: 'ready', checks });
  } else {
    res.status(503).json({ status: 'not ready', checks });
  }
});

app.get('/live', (req, res) => {
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

// WebSocket Connection Mappings
io.on('connection', (socket) => {
  Logger.info(`New WebSocket Connection: ${socket.id}`);

  // Auto-join user room based on connection handshake query parameter
  const userId = socket.handshake.query.userId as string;
  if (userId) {
    socket.join(userId);
    Logger.info(`Socket ${socket.id} auto-joined user room: ${userId}`);
  }

  // Active Symbol Interest Registration
  socket.on('join-interest', (symbols: string[]) => {
    QuoteInterestService.getInstance().registerInterest(socket.id, symbols);
    for (const sym of symbols) {
      const room = `interest:${sym.toUpperCase().trim()}`;
      socket.join(room);
      Logger.info(`Socket ${socket.id} joined interest room: ${room}`);
    }
  });

  socket.on('leave-interest', (symbols: string[]) => {
    QuoteInterestService.getInstance().unregisterInterest(socket.id, symbols);
    for (const sym of symbols) {
      const room = `interest:${sym.toUpperCase().trim()}`;
      socket.leave(room);
      Logger.info(`Socket ${socket.id} left interest room: ${room}`);
    }
  });

  // Channel Subscriptions
  socket.on('subscribe', (room: string) => {
    Logger.info(`Socket ${socket.id} subscribing to room: ${room}`);
    socket.join(room);
  });

  socket.on('unsubscribe', (room: string) => {
    Logger.info(`Socket ${socket.id} unsubscribing from room: ${room}`);
    socket.leave(room);
  });

  socket.on('disconnect', () => {
    Logger.info(`WebSocket Disconnected: ${socket.id}`);
    QuoteInterestService.getInstance().clearConnection(socket.id);
  });
});

// Centralized Error Interceptor
app.use(errorMiddleware);

// Boot server
const PORT = config.get('PORT');

async function startServer() {
  try {
    // Connect to Redis in the background without blocking server boot
    redisClient.connect().catch((err) => {
      Logger.warn('Redis background connection failed.', err);
    });

    redisSubscriber.connect().catch((err) => {
      Logger.warn('Redis Subscriber background connection failed.', err);
    });

    // Start background BullMQ workers
    try {
      initWorkers();
    } catch (err) {
      Logger.warn('Failed to initialize BullMQ workers (likely due to missing Redis connection).', err);
    }

    // Listen for price alerts and push to active Socket.io clients
    const notificationService = NotificationService.getInstance();
    notificationService.events.on('alert-triggered', (payload) => {
      Logger.info(`WebSocket: Pushing price alert trigger to room ${payload.userId} on ${payload.symbol}`);
      io.to(payload.userId).emit('price-alert', {
        id: payload.alertId,
        symbol: payload.symbol,
        condition: payload.condition,
        value: payload.value,
        currentPrice: payload.currentPrice,
      });
    });

    // Listen for catalog verification and notify watchlisted users
    marketEventBus.on(DomainEvent.TICKER_VERIFIED, async (payload: { symbol: string }) => {
      try {
        const { prisma } = await import('@stock-market/database');
        
        // Find users with this symbol in their watchlist
        const watchlistedUsers = await prisma.watchlistItem.findMany({
          where: { tickerId: payload.symbol.toUpperCase() }
        });

        for (const item of watchlistedUsers) {
          // Log activity log
          await prisma.activityLog.create({
            data: {
              userId: item.userId,
              message: `[WATCHLIST ALERT] Watchlisted ticker ${payload.symbol} is now verified and available for trading!`,
            }
          });

          // Push live event via Socket.io
          Logger.info(`WebSocket: Pushing catalog verification alert to user ${item.userId} for ${payload.symbol}`);
          io.to(item.userId).emit('catalog-verified', {
            symbol: payload.symbol,
            message: `Watchlisted ticker ${payload.symbol} is now verified and available for trading!`
          });
        }
      } catch (err) {
        Logger.error('Failed to distribute ticker verification alerts', err);
      }
    });

    // Start intelligent quote streaming engine
    const quoteService = QuoteService.getInstance();
    quoteService.startPolling();

    // Subscribe to Redis Pub/Sub ticks and forward to clients
    try {
      await redisSubscriber.subscribe('market:ticks', (message) => {
        try {
          const quote = JSON.parse(message);
          io.to(`interest:${quote.ticker}`).emit('price-update', quote);
        } catch (err) {
          Logger.error('Failed to parse price tick from Redis Pub/Sub', err);
        }
      });
    } catch (err) {
      Logger.error('Failed to subscribe to market:ticks channel', err);
    }

    // 14-minute keep-alive self-ping (prevents Render free tier spin-down for both API & Web)
    setInterval(async () => {
      const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      const activeConnections = io.sockets.sockets.size;
      const activeSymbols = QuoteInterestService.getInstance().getActiveSymbols().length;
      Logger.info(`[HEARTBEAT] API Gateway active. Memory: ${memUsage} MB, Active Connections: ${activeConnections}, Tracked Symbols: ${activeSymbols}`);

      // 1. Self-ping API Gateway to keep it awake
      try {
        const selfUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        const res = await fetch(`${selfUrl}/health`);
        Logger.info(`[HEARTBEAT] API self-ping status: ${res.status}`);
      } catch (err) {
        Logger.error('[HEARTBEAT] API self-ping failed', err);
      }

      // 2. Ping Frontend Web app to keep it awake
      try {
        const webDashboardUrl = process.env.WEB_APP_URL || 'http://localhost:3000/dashboard';
        const webBaseUrl = webDashboardUrl.replace('/dashboard', '');
        const res = await fetch(webBaseUrl);
        Logger.info(`[HEARTBEAT] Frontend Web self-ping status: ${res.status}`);
      } catch (err) {
        Logger.error('[HEARTBEAT] Frontend Web self-ping failed', err);
      }
    }, 14 * 60 * 1000);

    server.listen(PORT, () => {
      Logger.info(`🚀 API Gateway active on port ${PORT} in ${config.get('NODE_ENV')} mode`);
    });
  } catch (error) {
    Logger.error('Fatal: Failed to startup API server', error);
    process.exit(1);
  }
}

// Global typing extension
declare global {
  namespace Express {
    interface Request {
      cookies: Record<string, string>;
    }
  }
}

startServer();
