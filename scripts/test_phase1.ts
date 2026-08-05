import { prisma } from '@stock-market/database';
import { MarketService, ExchangeService } from '@stock-market/market';
import { MatchingEngine } from '@stock-market/orders';
import { OrderSide, OrderType, OrderStatus } from '@stock-market/shared';
import { Decimal } from '@prisma/client/runtime/library';

// Mock values
let mockPrice = 100;
let mockMarketOpen = true;

// Override prototype methods
MarketService.prototype.getQuote = async (ticker: string) => {
  return {
    symbol: ticker,
    price: mockPrice,
    change: 0,
    changePercent: 0,
    volume: 10000,
    updatedAt: new Date()
  };
};

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
  
  // Create or find role
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
    where: { email: 'test_margin_user@example.com' },
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
    await prisma.user.delete({ where: { email: 'test_margin_user@example.com' } });
  }

  // Create new user
  const user = await prisma.user.create({
    data: {
      email: 'test_margin_user@example.com',
      passwordHash: 'hashedpassword',
      name: 'Test Margin User',
      roleId: role.id,
    }
  });

  // Create account with $1,000 cash
  const account = await prisma.account.create({
    data: {
      userId: user.id,
      cashBalance: new Decimal(1000.0),
      baseCurrency: 'USD'
    }
  });

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

  // Check or create Ticker
  let ticker = await prisma.ticker.findUnique({ where: { id: 'AAPL' } });
  if (!ticker) {
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

  return { user, account, ticker };
}

async function runTests() {
  const { account, ticker } = await setupTestData();
  const engine = MatchingEngine.getInstance();

  console.log('\n=======================================');
  console.log('TEST 1: Validate Initial Margin check on short orders');
  console.log('=======================================');

  mockPrice = 100;
  mockMarketOpen = true;

  // Case 1: Sell short 10 shares of AAPL at $100.
  // SMV = $1,000. Required initial margin (50%) = $500. Cash = $1,000.
  // This should succeed!
  console.log('Attempting valid short sale of 10 shares (value $1000, req margin $500, cash $1000)...');
  try {
    const res = await engine.submitOrder(
      account.id,
      'AAPL',
      OrderSide.SELL,
      OrderType.MARKET,
      10
    );
    console.log('✅ Success! Order status:', res.status);
  } catch (err: any) {
    console.error('❌ Failed! Error:', err.message);
  }

  // Case 2: Sell short 30 shares of AAPL at $100.
  // SMV = $3,000. Required initial margin (50%) = $1,500. Cash = $1,000. (Plus any short proceeds from previous, but equity is what is checked).
  // Cash balance after first trade is $1000 + 1000 - 2 = $1998.
  // Existing position: 10 shares short.
  // We want to sell 30 more shares. Total resulting short: 40 shares.
  // Resulting short value: $4,000. Initial margin required: $2,000.
  // Our equity: $1998 - $1000 - 2 = $996.
  // $996 < $2000, so this should fail!
  console.log('\nAttempting invalid short sale of 30 shares (value $3000, req margin $2000, equity $996)...');
  try {
    await engine.submitOrder(
      account.id,
      'AAPL',
      OrderSide.SELL,
      OrderType.MARKET,
      30
    );
    console.log('❌ Failed! Order should have been rejected for insufficient margin.');
  } catch (err: any) {
    console.log('✅ Success! Order rejected as expected. Error:', err.message);
  }

  console.log('\n=======================================');
  console.log('TEST 2: Validate Market Hours Enforcements');
  console.log('=======================================');

  mockMarketOpen = false;
  console.log('Setting market open = false');

  console.log('Submitting LIMIT order when market is closed...');
  const limitOrderRes = await engine.submitOrder(
    account.id,
    'AAPL',
    OrderSide.BUY,
    OrderType.LIMIT,
    1,
    100
  );
  console.log('LIMIT order status:', limitOrderRes.status); // should be PENDING

  console.log('Running matchPendingOrders() while market is closed...');
  await engine.matchPendingOrders();

  let checkOrder = await prisma.order.findUnique({ where: { id: limitOrderRes.orderId } });
  console.log('Order status after match (should still be PENDING):', checkOrder?.status);

  console.log('\nSetting market open = true');
  mockMarketOpen = true;

  console.log('Running matchPendingOrders() while market is open...');
  await engine.matchPendingOrders();

  checkOrder = await prisma.order.findUnique({ where: { id: limitOrderRes.orderId } });
  console.log('Order status after match (should be FILLED):', checkOrder?.status);

  console.log('\n=======================================');
  console.log('TEST 3: Validate Margin Call Continuous Auditor and Liquidation');
  console.log('=======================================');

  // Let's reset the cash and positions
  await prisma.position.deleteMany({ where: { accountId: account.id } });
  await prisma.order.deleteMany({ where: { accountId: account.id } });
  await prisma.account.update({
    where: { id: account.id },
    data: {
      cashBalance: new Decimal(1000.0),
      marginCallActive: false,
      marginCallAt: null,
      marginCallDeadline: null
    }
  });

  // Short 10 shares of AAPL at $100
  mockPrice = 100;
  console.log('Shorting 10 shares of AAPL at $100...');
  await engine.submitOrder(
    account.id,
    'AAPL',
    OrderSide.SELL,
    OrderType.MARKET,
    10
  );

  let updatedAcc = await prisma.account.findUnique({ where: { id: account.id } });
  let pos = await prisma.position.findFirst({ where: { accountId: account.id, tickerId: 'AAPL' } });
  console.log('Cash Balance:', updatedAcc?.cashBalance.toNumber());
  console.log('Position quantity:', pos?.quantity.toNumber(), 'isShort:', pos?.isShort);

  console.log('Running auditAccountsMargin()...');
  await engine.auditAccountsMargin();

  updatedAcc = await prisma.account.findUnique({ where: { id: account.id } });
  console.log('Is Margin Call active? (expected false):', updatedAcc?.marginCallActive);

  // Now price rises to $160
  mockPrice = 160;
  console.log('\nForce price of AAPL to rise to $160...');
  console.log('Running auditAccountsMargin()...');
  await engine.auditAccountsMargin();

  updatedAcc = await prisma.account.findUnique({ where: { id: account.id } });
  console.log('Is Margin Call active? (expected true):', updatedAcc?.marginCallActive);
  console.log('Margin Call At:', updatedAcc?.marginCallAt);
  console.log('Margin Call Deadline:', updatedAcc?.marginCallDeadline);

  // Mock deadline passed (set deadline to 20 minutes ago)
  console.log('\nSimulating deadline expired (updating marginCallDeadline to 20 minutes ago)...');
  await prisma.account.update({
    where: { id: account.id },
    data: {
      marginCallDeadline: new Date(Date.now() - 20 * 60 * 1000)
    }
  });

  console.log('Running auditAccountsMargin() again to trigger liquidation...');
  await engine.auditAccountsMargin();

  updatedAcc = await prisma.account.findUnique({ where: { id: account.id } });
  pos = await prisma.position.findFirst({ where: { accountId: account.id, tickerId: 'AAPL' } });
  console.log('Is Margin Call active? (expected false, since liquidated):', updatedAcc?.marginCallActive);
  console.log('Cash Balance after liquidation:', updatedAcc?.cashBalance.toNumber());
  console.log('Position quantity (expected undefined/null):', pos);

  const logs = await prisma.marginCallLog.findMany({ where: { accountId: account.id } });
  console.log('Margin Call Logs:', logs.map(l => ({
    equityAtCall: l.equityAtCall.toNumber(),
    requiredEquity: l.requiredEquity.toNumber(),
    resolution: l.resolution
  })));

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
