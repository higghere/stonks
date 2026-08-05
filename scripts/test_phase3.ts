import { prisma } from '@stock-market/database';
import { MarketService, QuoteService } from '@stock-market/market';
import { createClient } from 'redis';
import { ConfigService } from '@stock-market/config';

// Mock values
let mockHistoryBars = [
  { time: 1718000000, open: 100, high: 105, low: 95, close: 102, volume: 1000 },
  { time: 1718000300, open: 102, high: 107, low: 98, close: 105, volume: 1200 },
];
let providerCallCount = 0;

async function setupTestData() {
  console.log('--- Setting up test data ---');
  // Make sure Ticker AAPL exists
  let ticker = await prisma.ticker.findUnique({ where: { id: 'AAPL' } });
  if (!ticker) {
    // Check or create Exchange
    let exchange = await prisma.exchange.findFirst({ where: { id: 'TESTEX' } });
    if (!exchange) {
      exchange = await prisma.exchange.create({
        data: {
          id: 'TESTEX',
          name: 'Test Exchange',
          country: 'US',
          timezone: 'America/New_York',
          openingTime: '09:30',
          closingTime: '16:00',
          currency: 'USD'
        }
      });
    }

    ticker = await prisma.ticker.create({
      data: {
        id: 'AAPL',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetType: 'EQUITY',
        exchangeId: 'TESTEX',
        currency: 'USD',
        volatility: 0.02
      }
    });
  }

  // Clear any existing test candles for AAPL
  await prisma.oHLCCandle.deleteMany({
    where: { tickerId: 'AAPL', timeframe: '5m' }
  });
}

async function runTests() {
  await setupTestData();

  const marketService = MarketService.getInstance();

  console.log('\n=======================================');
  console.log('TEST 1: Validate OHLCCandle DB Caching & Backfilling');
  console.log('=======================================');

  // Override primaryProvider.getHistory
  (marketService as any).primaryProvider.getHistory = async (
    ticker: string,
    resolution: string,
    from: number,
    to: number
  ) => {
    providerCallCount++;
    console.log(`Provider getHistory called for ${ticker} (${resolution})`);
    return mockHistoryBars;
  };

  // First call to getHistory - should call the provider
  console.log('First query (cache miss, should query provider)...');
  providerCallCount = 0;
  const bars1 = await marketService.getHistory('AAPL', '5m', 1718000000, 1718000500);
  console.log('Bars retrieved:', bars1.length);
  console.log('Provider calls:', providerCallCount); // Expected: 1

  // Wait 1 second for the async backfill tasks to write to DB
  console.log('Waiting 1 second for DB backfill to complete...');
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Verify candles exist in DB
  const dbCandles = await prisma.oHLCCandle.findMany({
    where: { tickerId: 'AAPL', timeframe: '5m' }
  });
  console.log('Candles verified in local DB (Expected: 2):', dbCandles.length);

  // Second call to getHistory - should hit the database, providerCallCount should remain the same
  console.log('\nSecond query (cache hit, should read DB, skipping provider)...');
  providerCallCount = 0;
  const bars2 = await marketService.getHistory('AAPL', '5m', 1718000000, 1718000500);
  console.log('Bars retrieved:', bars2.length);
  console.log('Provider calls (Expected: 0):', providerCallCount);

  console.log('\n=======================================');
  console.log('TEST 2: Validate Redis Pub/Sub Tick Propagation');
  console.log('=======================================');

  const config = ConfigService.getInstance();
  const redisUrl = config.get('REDIS_URL') || 'redis://localhost:6379';
  const redisSub = createClient({ url: redisUrl });
  await redisSub.connect();
  console.log('Connected to Redis Subscriber');

  const receivedTicks: any[] = [];
  await redisSub.subscribe('market:ticks', (message) => {
    const quote = JSON.parse(message);
    receivedTicks.push(quote);
    console.log(`Redis Pub/Sub Tick Received: ${quote.ticker} at $${quote.price}`);
  });

  // Mock getQuote to return a test price update
  marketService.getQuote = async (ticker: string) => {
    return {
      ticker: ticker.toUpperCase(),
      price: 150.0,
      change: 0,
      changePercent: 0,
      volume: 1000,
      high: 150,
      low: 150,
      open: 150,
      previousClose: 150,
      timestamp: Date.now()
    };
  };

  marketService.getQuotes = async (tickers: string[]) => {
    const results: Record<string, any> = {};
    for (const t of tickers) {
      results[t.toUpperCase()] = await marketService.getQuote(t);
    }
    return results;
  };

  // Register interest for QuoteService to poll
  const interestService = (QuoteService.getInstance() as any).interestService;
  interestService.registerInterest('connection-test', ['AAPL']);

  console.log('Starting QuoteService polling to publish tick...');
  QuoteService.getInstance().startPolling();

  // Wait 6 seconds to allow at least one polling loop (polls every 5s)
  console.log('Waiting 6 seconds for tick to publish...');
  await new Promise(resolve => setTimeout(resolve, 6000));

  QuoteService.getInstance().stopPolling();
  await redisSub.unsubscribe('market:ticks');
  await redisSub.disconnect();

  console.log('Total ticks received via Redis Pub/Sub (Expected: >= 1):', receivedTicks.length);
  if (receivedTicks.length >= 1) {
    console.log('✅ Redis Pub/Sub Tick Propagation verified successfully!');
  } else {
    console.log('❌ Failed: No ticks received via Redis Pub/Sub.');
  }

  console.log('\n--- Tests Complete ---');
}

runTests()
  .catch(err => {
    console.error('Unexpected error in test runner:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
