import { prisma } from '@stock-market/database';
import { MarketService, ExchangeService } from '@stock-market/market';
import { MatchingEngine } from '@stock-market/orders';
import { PortfolioService } from '@stock-market/portfolio';
import { OrderSide, OrderType } from '@stock-market/shared';
import { Decimal } from '@prisma/client/runtime/library';

// Mock values
let mockMarketOpen = true;
let normalRandomVal = 0.0; // Control random slippage

// Override prototype methods
MatchingEngine.prototype.getNormalRandom = () => {
  return normalRandomVal;
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
  
  // Find and delete old test user/account
  const oldUser = await prisma.user.findUnique({
    where: { email: 'test_fx_user@example.com' },
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
    await prisma.user.delete({ where: { email: 'test_fx_user@example.com' } });
  }

  // Find role
  const role = await prisma.role.findFirst({ where: { id: 'test-role' } });
  if (!role) throw new Error('Role test-role not found');

  // Create new user
  const user = await prisma.user.create({
    data: {
      email: 'test_fx_user@example.com',
      passwordHash: 'hashedpassword',
      name: 'Test FX User',
      roleId: role.id,
    }
  });

  // Create account with $1,000 USD cash
  const account = await prisma.account.create({
    data: {
      userId: user.id,
      cashBalance: new Decimal(1000.0),
      baseCurrency: 'USD'
    }
  });

  // Check or create GBP Ticker
  let tickerGBP = await prisma.ticker.findUnique({ where: { id: 'BARC' } });
  if (!tickerGBP) {
    // Check or create LSE Exchange
    let exchangeGBP = await prisma.exchange.findFirst({ where: { id: 'LSE' } });
    if (!exchangeGBP) {
      exchangeGBP = await prisma.exchange.create({
        data: {
          id: 'LSE',
          name: 'London Stock Exchange',
          country: 'GB',
          timezone: 'Europe/London',
          openingTime: '08:00',
          closingTime: '16:30',
          currency: 'GBP'
        }
      });
    }

    tickerGBP = await prisma.ticker.create({
      data: {
        id: 'BARC',
        symbol: 'BARC',
        name: 'Barclays PLC',
        assetType: 'EQUITY',
        exchangeId: 'LSE',
        currency: 'GBP',
        volatility: 0.02
      }
    });
  }

  // Seed GBPUSD exchange rate ticker
  let tickerFx = await prisma.ticker.findUnique({ where: { id: 'GBPUSD=X' } });
  if (!tickerFx) {
    tickerFx = await prisma.ticker.create({
      data: {
        id: 'GBPUSD=X',
        symbol: 'GBPUSD=X',
        name: 'GBP/USD Rate',
        assetType: 'FOREX',
        exchangeId: 'TESTEX',
        currency: 'USD',
        volatility: 0.0003
      }
    });
  }

  return { user, account, tickerGBP };
}

async function runTests() {
  const { user, account, tickerGBP } = await setupTestData();
  const engine = MatchingEngine.getInstance();
  const portfolioService = PortfolioService.getInstance();
  const marketService = MarketService.getInstance();

  console.log('\n=======================================');
  console.log('TEST 1: Validate Bid/Ask Spread & Slippage Calculation');
  console.log('=======================================');

  // Mid price = 100, Volatility = 0.02
  // Spread % = max(0.02 * 0.05, 0.0001) = 0.001 (0.1% spread, i.e. 0.05% half-spread)
  // For BUY:
  // Ask price = 100 * (1 + 0.0005) = 100.05
  // If getNormalRandom() = 1.0: slippagePct = 1.0 * 0.02 * 0.1 = 0.002
  // Final price = 100.05 * 1.002 = 100.2501
  normalRandomVal = 1.0;
  const buyPrice = engine.calculateExecutionPrice(100, 0.02, OrderSide.BUY);
  console.log('BUY execution price (Expected: 100.2501):', buyPrice);

  // For SELL:
  // Bid price = 100 * (1 - 0.0005) = 99.95
  // If getNormalRandom() = 1.0: slippagePct = 0.002
  // Final price = 99.95 * (1 - 0.002) = 99.7501
  const sellPrice = engine.calculateExecutionPrice(100, 0.02, OrderSide.SELL);
  console.log('SELL execution price (Expected: 99.7501):', sellPrice);

  console.log('\n=======================================');
  console.log('TEST 2: Validate FX Conversion & Cash Adjustment');
  console.log('=======================================');

  // We want to mock GBPUSD=X rate as 1.28
  // And BARC price as £100
  marketService.getQuote = async (ticker: string) => {
    const sym = ticker.toUpperCase();
    if (sym === 'GBPUSD=X') {
      return {
        ticker: 'GBPUSD=X',
        price: 1.28,
        change: 0,
        changePercent: 0,
        volume: 0,
        high: 1.28,
        low: 1.28,
        open: 1.28,
        previousClose: 1.28,
        timestamp: Date.now()
      };
    }
    if (sym === 'BARC') {
      return {
        ticker: 'BARC',
        price: 100.00,
        change: 0,
        changePercent: 0,
        volume: 0,
        high: 100.00,
        low: 100.00,
        open: 100.00,
        previousClose: 100.00,
        timestamp: Date.now()
      };
    }
    throw new Error(`Unexpected quote request for ${ticker}`);
  };

  // Override getQuotes as well to return the mocked values
  marketService.getQuotes = async (tickers: string[]) => {
    const results: Record<string, any> = {};
    for (const t of tickers) {
      results[t.toUpperCase()] = await marketService.getQuote(t);
    }
    return results;
  };

  // Let's set random slippage to 0 for deterministic calculations
  normalRandomVal = 0.0;
  // Sell short 10 shares of BARC at £100 mid price
  // finalPrice = 100 * (1 - 0.0005) = £99.95
  // Total cost in GBP = 10 * 99.95 = £999.50
  // In USD = £999.50 * 1.28 = $1,279.36
  // Cash change = +$1,279.36 - $2.00 commission = $1,277.36
  // Expected final Cash balance = $1,000 + $1,277.36 = $2,277.36
  console.log('Shorting 10 shares of BARC (LSE, GBP) at £100 midprice...');
  await engine.submitOrder(
    account.id,
    'BARC',
    OrderSide.SELL,
    OrderType.MARKET,
    10
  );

  let updatedAcc = await prisma.account.findUnique({ where: { id: account.id } });
  console.log('New USD Cash Balance (Expected: 2277.36):', updatedAcc?.cashBalance.toNumber());

  const executions = await prisma.execution.findMany({
    include: { order: true }
  });
  const exec = executions.find(e => e.order.accountId === account.id);
  console.log('Execution price in native currency (Expected: 99.95):', exec?.price.toNumber());

  console.log('\n=======================================');
  console.log('TEST 3: Validate Portfolio Valuation with FX & Short Positions');
  console.log('=======================================');

  // Now price of BARC rises to £110
  // Short position liability in GBP = -10 * £110 = -£1,100
  // In USD = -£1,100 * 1.28 = -$1,408
  // Cash in USD = $2,277.36
  // Expected NAV = $2,277.36 - $1,408 = $869.36
  // Expected unrealized Pl = (£99.95 - £110) * 10 * 1.28 = -£10.05 * 10 * 1.28 = -$128.64
  marketService.getQuote = async (ticker: string) => {
    const sym = ticker.toUpperCase();
    if (sym === 'GBPUSD=X') {
      return { ticker: 'GBPUSD=X', price: 1.28, change: 0, changePercent: 0, volume: 0, high: 1.28, low: 1.28, open: 1.28, previousClose: 1.28, timestamp: Date.now() };
    }
    if (sym === 'BARC') {
      return { ticker: 'BARC', price: 110.00, change: 0, changePercent: 0, volume: 0, high: 110.00, low: 110.00, open: 110.00, previousClose: 110.00, timestamp: Date.now() };
    }
    throw new Error(`Unexpected quote request for ${ticker}`);
  };

  console.log('Calculating portfolio valuation...');
  const valuation = await portfolioService.getPortfolioValuation(user.id);
  console.log('NAV (Expected: 869.36):', valuation.account.netAssetValue);
  console.log('Total Holdings Value (Expected: -1408):', valuation.account.totalHoldingsValue);
  console.log('Position Valuation details:', valuation.positions[0]);

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
