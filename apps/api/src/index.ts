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
import { authRoutes } from './routes/auth.routes';
import { marketRoutes } from './routes/market.routes';
import { orderRoutes } from './routes/order.routes';
import { portfolioRoutes } from './routes/portfolio.routes';
import { watchlistRoutes } from './routes/watchlist.routes';
import { alertRoutes } from './routes/alert.routes';
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
    await redisClient.connect();

    // Start background BullMQ workers
    initWorkers();

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

    // Start intelligent quote streaming engine
    const quoteService = QuoteService.getInstance();
    quoteService.startPolling((quote) => {
      io.to(`interest:${quote.ticker}`).emit('price-update', quote);
    });

    // 14-minute keep-alive self-ping (prevents Render free tier spin-down)
    setInterval(async () => {
      const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      const activeConnections = io.sockets.sockets.size;
      const activeSymbols = QuoteInterestService.getInstance().getActiveSymbols().length;
      Logger.info(`[HEARTBEAT] API Gateway active. Memory: ${memUsage} MB, Active Connections: ${activeConnections}, Tracked Symbols: ${activeSymbols}`);

      // Self-ping to keep Render from spinning down
      try {
        const selfUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        const res = await fetch(`${selfUrl}/health`);
        Logger.info(`[HEARTBEAT] Self-ping status: ${res.status}`);
      } catch (err) {
        Logger.error('[HEARTBEAT] Self-ping failed', err);
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
