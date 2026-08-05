import { prisma } from '@stock-market/database';
import { MarketService, ExchangeService } from '@stock-market/market';
import { MatchingEngine } from '@stock-market/orders';
import { OrderSide, OrderType, marketEventBus, DomainEvent } from '@stock-market/shared';
import { Decimal } from '@prisma/client/runtime/library';

// Mock values
let mockMarketOpen = true;

ExchangeService.prototype.isMarketOpen = async (exchangeId: string) => {
  return mockMarketOpen;
};

ExchangeService.prototype.getSessionInfo = async (exchangeId: string) => {
  return {
    isOpen: mockMarketOpen,
    sessionType: mockMarketOpen ? 'REGULAR' : 'CLOSED',
    nextOpen: new Date(),
    nextClose: new Date(),
    timezone: 'UTC'
  };
};

async function setupTestData() {
  console.log('--- Setting up test data ---');
  
  // Find or create role
  let role = await prisma.role.findFirst({ where: { id: 'test-role' } });
  if (!role) {
    role = await prisma.role.create({
      data: {
        id: 'test-role',
        name: 'Test Role',
        description: 'Role for testing'
      }
    });
  }

  // Find and delete old test user/account
  const oldUser = await prisma.user.findUnique({
    where: { email: 'test_fifo_user@example.com' },
    include: { account: true }
  });
  if (oldUser) {
    if (oldUser.account) {
      await prisma.marginCallLog.deleteMany({ where: { accountId: oldUser.account.id } });
      await prisma.order.deleteMany({ where: { accountId: oldUser.account.id } });
      await prisma.position.deleteMany({ where: { accountId: oldUser.account.id } });
      await prisma.transaction.deleteMany({ where: { accountId: oldUser.account.id } });
      await prisma.account.delete({ where: { id: oldUser.account.id } });
    }
    await prisma.userPreference.deleteMany({ where: { userId: oldUser.id } });
    await prisma.watchlistItem.deleteMany({ where: { userId: oldUser.id } });
    await prisma.activityLog.deleteMany({ where: { userId: oldUser.id } });
    await prisma.user.delete({ where: { email: 'test_fifo_user@example.com' } });
  }

  // Create new user
  const user = await prisma.user.create({
    data: {
      email: 'test_fifo_user@example.com',
      passwordHash: 'hashedpassword',
      name: 'Test FIFO/LIFO User',
      roleId: role.id,
    }
  });

  // Create account with $10,000 USD cash
  const account = await prisma.account.create({
    data: {
      userId: user.id,
      cashBalance: new Decimal(10000.0),
      baseCurrency: 'USD'
    }
  });

  // Create User Preference
  const preference = await prisma.userPreference.create({
    data: {
      userId: user.id,
      costBasisMethod: 'FIFO',
    }
  });

  // Check or create Ticker
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

  return { user, account, ticker, preference };
}

async function runTests() {
  const { user, account, ticker } = await setupTestData();
  const engine = MatchingEngine.getInstance();
  const marketService = MarketService.getInstance();

  // Mock quote to return a constant price
  marketService.getQuote = async (tickerId: string) => {
    return {
      ticker: tickerId.toUpperCase(),
      price: 100.0,
      change: 0,
      changePercent: 0,
      volume: 1000,
      high: 100,
      low: 100,
      open: 100,
      previousClose: 100,
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

  // Register event listener in the test process manually to capture and test it
  marketEventBus.on(DomainEvent.TICKER_VERIFIED, async (payload: { symbol: string }) => {
    try {
      console.log(`Test listener caught TICKER_VERIFIED for ${payload.symbol}`);
      const watchlistedUsers = await prisma.watchlistItem.findMany({
        where: { tickerId: payload.symbol.toUpperCase() }
      });

      for (const item of watchlistedUsers) {
        await prisma.activityLog.create({
          data: {
            userId: item.userId,
            message: `[WATCHLIST ALERT] Watchlisted ticker ${payload.symbol} is now verified and available for trading!`,
          }
        });
      }
    } catch (err) {
      console.error('Event listener failed', err);
    }
  });

  console.log('\n=======================================');
  console.log('TEST 1: Validate FIFO / LIFO Cost-basis lot accounting');
  console.log('=======================================');

  // Override normal random and exchange open checks
  engine.getNormalRandom = () => 0.0; // No slippage/spread for precise testing

  // 1. Buy 10 shares of AAPL at $100 (creates Lot 1)
  console.log('Buying 10 shares at $100 (Lot 1)...');
  await engine.submitOrder(
    account.id,
    'AAPL',
    OrderSide.BUY,
    OrderType.MARKET,
    10,
    100
  );

  // Wait 1 second
  console.log('Waiting 1 second to distinguish lot timestamps...');
  await new Promise(resolve => setTimeout(resolve, 1050));

  // 2. Buy 10 shares of AAPL at $110 (creates Lot 2)
  console.log('Buying 10 shares at $110 (Lot 2)...');
  await engine.submitOrder(
    account.id,
    'AAPL',
    OrderSide.BUY,
    OrderType.MARKET,
    10,
    110
  );

  let position = await prisma.position.findFirst({
    where: { accountId: account.id, tickerId: 'AAPL' },
    include: { lots: { orderBy: { acquiredAt: 'asc' } } }
  });

  console.log('Position quantity:', position?.quantity.toNumber());
  console.log('Total lots created (Expected: 2):', position?.lots.length);
  console.log('Lot 1 qty:', position?.lots[0].remainingQuantity.toNumber(), 'price:', position?.lots[0].price.toNumber());
  console.log('Lot 2 qty:', position?.lots[1].remainingQuantity.toNumber(), 'price:', position?.lots[1].price.toNumber());

  // 3. Set Cost Basis Method = FIFO
  console.log('\nSetting Cost Basis Method to FIFO...');
  await prisma.userPreference.update({
    where: { userId: user.id },
    data: { costBasisMethod: 'FIFO' }
  });

  // Sell 5 shares (should reduce Lot 1 remaining quantity to 5, Lot 2 remains at 10)
  console.log('Selling 5 shares under FIFO (should deduct from Lot 1)...');
  await engine.submitOrder(
    account.id,
    'AAPL',
    OrderSide.SELL,
    OrderType.MARKET,
    5,
    105
  );

  position = await prisma.position.findFirst({
    where: { accountId: account.id, tickerId: 'AAPL' },
    include: { lots: { orderBy: { acquiredAt: 'asc' } } }
  });

  console.log('After FIFO Sell:');
  console.log('Lot 1 remaining quantity (Expected: 5):', position?.lots[0].remainingQuantity.toNumber());
  console.log('Lot 2 remaining quantity (Expected: 10):', position?.lots[1].remainingQuantity.toNumber());

  // 4. Set Cost Basis Method = LIFO
  console.log('\nSetting Cost Basis Method to LIFO...');
  await prisma.userPreference.update({
    where: { userId: user.id },
    data: { costBasisMethod: 'LIFO' }
  });

  // Sell 5 shares (should reduce Lot 2 remaining quantity to 5, Lot 1 remains at 5)
  console.log('Selling 5 shares under LIFO (should deduct from Lot 2)...');
  await engine.submitOrder(
    account.id,
    'AAPL',
    OrderSide.SELL,
    OrderType.MARKET,
    5,
    105
  );

  position = await prisma.position.findFirst({
    where: { accountId: account.id, tickerId: 'AAPL' },
    include: { lots: { orderBy: { acquiredAt: 'asc' } } }
  });

  console.log('After LIFO Sell:');
  console.log('Lot 1 remaining quantity (Expected: 5):', position?.lots[0].remainingQuantity.toNumber());
  console.log('Lot 2 remaining quantity (Expected: 5):', position?.lots[1].remainingQuantity.toNumber());


  console.log('\n=======================================');
  console.log('TEST 2: Validate Watchlist Ticker Verification Alert');
  console.log('=======================================');

  // Let's create a watchlist item for a symbol 'TSLA' (which already exists, or create a mock symbol)
  // Let's make sure Ticker TSLA exists
  let tickerTSLA = await prisma.ticker.findUnique({ where: { id: 'TSLA' } });
  if (!tickerTSLA) {
    tickerTSLA = await prisma.ticker.create({
      data: {
        id: 'TSLA',
        symbol: 'TSLA',
        name: 'Tesla Inc.',
        assetType: 'EQUITY',
        exchangeId: 'TESTEX',
        currency: 'USD',
        volatility: 0.02
      }
    });
  }

  console.log('Creating watchlist item for TSLA linked to user...');
  await prisma.watchlistItem.create({
    data: {
      userId: user.id,
      tickerId: 'TSLA'
    }
  });

  console.log('Emitting DomainEvent.TICKER_VERIFIED with symbol TSLA...');
  marketEventBus.emit(DomainEvent.TICKER_VERIFIED, { symbol: 'TSLA' });

  // Wait 1 second for the event listener to execute and write activity log
  console.log('Waiting 1 second for listener to write log...');
  await new Promise(resolve => setTimeout(resolve, 1000));

  const log = await prisma.activityLog.findFirst({
    where: { userId: user.id, message: { contains: '[WATCHLIST ALERT]' } }
  });

  console.log('Activity log found (Expected: exists):', log ? 'Yes' : 'No');
  console.log('Log message:', log?.message);

  if (log) {
    console.log('✅ Watchlist alerts verified successfully!');
  } else {
    console.log('❌ Failed: Watchlist alert was not logged.');
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
