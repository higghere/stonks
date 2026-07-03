import { PrismaClient } from '@stock-market/database';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // 1. Seed Permissions
  const permissionsList = [
    { id: 'read:portfolio', description: 'Read portfolio holdings and cash balance' },
    { id: 'write:order', description: 'Create and submit trade orders' },
    { id: 'read:alerts', description: 'View user alerts' },
    { id: 'write:alerts', description: 'Create and delete price alerts' },
    { id: 'admin:all', description: 'Complete administrative access' },
  ];

  console.log('Creating permissions...');
  for (const perm of permissionsList) {
    await prisma.permission.upsert({
      where: { id: perm.id },
      update: { description: perm.description },
      create: perm,
    });
  }

  // 2. Seed Roles
  console.log('Creating roles...');
  await prisma.role.upsert({
    where: { id: 'admin' },
    update: { name: 'Administrator' },
    create: { id: 'admin', name: 'Administrator', description: 'Platform Administrator' },
  });

  await prisma.role.upsert({
    where: { id: 'user' },
    update: { name: 'Trader' },
    create: { id: 'user', name: 'Trader', description: 'Standard Retail Trader' },
  });

  // 3. Link Role Permissions
  console.log('Linking role permissions...');
  const userPerms = ['read:portfolio', 'write:order', 'read:alerts', 'write:alerts'];
  for (const permId of userPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: 'user',
          permissionId: permId,
        },
      },
      update: {},
      create: { roleId: 'user', permissionId: permId },
    });
  }

  const adminPerms = [...userPerms, 'admin:all'];
  for (const permId of adminPerms) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: 'admin',
          permissionId: permId,
        },
      },
      update: {},
      create: { roleId: 'admin', permissionId: permId },
    });
  }

  // 4. Seed Exchanges
  console.log('Creating exchanges...');
  const exchanges = [
    {
      id: 'NASDAQ',
      name: 'Nasdaq Stock Market',
      country: 'USA',
      timezone: 'America/New_York',
      openingTime: '09:30',
      closingTime: '16:00',
      currency: 'USD',
    },
    {
      id: 'NYSE',
      name: 'New York Stock Exchange',
      country: 'USA',
      timezone: 'America/New_York',
      openingTime: '09:30',
      closingTime: '16:00',
      currency: 'USD',
    },
    {
      id: 'LSE',
      name: 'London Stock Exchange',
      country: 'UK',
      timezone: 'Europe/London',
      openingTime: '08:00',
      closingTime: '16:30',
      currency: 'GBP',
    },
  ];

  for (const ex of exchanges) {
    await prisma.exchange.upsert({
      where: { id: ex.id },
      update: ex,
      create: ex,
    });
  }

  // 5. Seed Tickers
  console.log('Creating tickers...');
  const tickers = [
    // Tech
    { id: 'AAPL', name: 'Apple Inc.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Technology', industry: 'Consumer Electronics', currency: 'USD' },
    { id: 'MSFT', name: 'Microsoft Corp.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Technology', industry: 'Software—Infrastructure', currency: 'USD' },
    { id: 'GOOGL', name: 'Alphabet Inc.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Technology', industry: 'Internet Content & Information', currency: 'USD' },
    { id: 'AMZN', name: 'Amazon.com Inc.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Consumer Cyclical', industry: 'Internet Retail', currency: 'USD' },
    { id: 'TSLA', name: 'Tesla Inc.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', currency: 'USD' },
    { id: 'NVDA', name: 'NVIDIA Corp.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', currency: 'USD' },
    { id: 'META', name: 'Meta Platforms Inc.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Technology', industry: 'Internet Content & Information', currency: 'USD' },
    { id: 'NFLX', name: 'Netflix Inc.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Communication Services', industry: 'Entertainment', currency: 'USD' },
    { id: 'AMD', name: 'Advanced Micro Devices Inc.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', currency: 'USD' },
    { id: 'INTC', name: 'Intel Corp.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', currency: 'USD' },
    { id: 'ADBE', name: 'Adobe Inc.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Technology', industry: 'Software—Infrastructure', currency: 'USD' },
    { id: 'CRM', name: 'Salesforce Inc.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Technology', industry: 'Software—Application', currency: 'USD' },
    { id: 'ORCL', name: 'Oracle Corp.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Technology', industry: 'Software—Application', currency: 'USD' },
    { id: 'CSCO', name: 'Cisco Systems Inc.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Technology', industry: 'Communication Equipment', currency: 'USD' },
    { id: 'AVGO', name: 'Broadcom Inc.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', currency: 'USD' },
    { id: 'ASML', name: 'ASML Holding N.V.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Technology', industry: 'Semiconductors', currency: 'USD' },
    
    // Financials
    { id: 'JPM', name: 'JPMorgan Chase & Co.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Financial Services', industry: 'Banks—Diversified', currency: 'USD' },
    { id: 'BAC', name: 'Bank of America Corp.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Financial Services', industry: 'Banks—Diversified', currency: 'USD' },
    { id: 'WFC', name: 'Wells Fargo & Co.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Financial Services', industry: 'Banks—Diversified', currency: 'USD' },
    { id: 'MS', name: 'Morgan Stanley', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Financial Services', industry: 'Capital Markets', currency: 'USD' },
    { id: 'GS', name: 'Goldman Sachs Group Inc.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Financial Services', industry: 'Capital Markets', currency: 'USD' },
    { id: 'V', name: 'Visa Inc.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Financial Services', industry: 'Credit Services', currency: 'USD' },
    { id: 'MA', name: 'Mastercard Inc.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Financial Services', industry: 'Credit Services', currency: 'USD' },
    { id: 'BARC', name: 'Barclays PLC', assetType: 'STOCK', exchangeId: 'LSE', sector: 'Financial Services', industry: 'Banks—Diversified', currency: 'GBP' },
    
    // Consumer & Retail
    { id: 'WMT', name: 'Walmart Inc.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Consumer Defensive', industry: 'Discount Stores', currency: 'USD' },
    { id: 'TGT', name: 'Target Corp.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Consumer Defensive', industry: 'Discount Stores', currency: 'USD' },
    { id: 'COST', name: 'Costco Wholesale Corp.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Consumer Defensive', industry: 'Discount Stores', currency: 'USD' },
    { id: 'KO', name: 'Coca-Cola Co.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Consumer Defensive', industry: 'Beverages—Non-Alcoholic', currency: 'USD' },
    { id: 'PEP', name: 'PepsiCo Inc.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Consumer Defensive', industry: 'Beverages—Non-Alcoholic', currency: 'USD' },
    { id: 'NKE', name: 'Nike Inc.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Consumer Cyclical', industry: 'Footwear & Accessories', currency: 'USD' },
    { id: 'SBUX', name: 'Starbucks Corp.', assetType: 'STOCK', exchangeId: 'NASDAQ', sector: 'Consumer Cyclical', industry: 'Restaurants', currency: 'USD' },
    { id: 'MCD', name: 'McDonald\'s Corp.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Consumer Cyclical', industry: 'Restaurants', currency: 'USD' },
    { id: 'DIS', name: 'The Walt Disney Co.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Communication Services', industry: 'Entertainment', currency: 'USD' },
    
    // Healthcare & Industrials
    { id: 'LLY', name: 'Eli Lilly & Co.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Healthcare', industry: 'Drug Manufacturers—General', currency: 'USD' },
    { id: 'JNJ', name: 'Johnson & Johnson', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Healthcare', industry: 'Drug Manufacturers—General', currency: 'USD' },
    { id: 'PFE', name: 'Pfizer Inc.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Healthcare', industry: 'Drug Manufacturers—General', currency: 'USD' },
    { id: 'CAT', name: 'Caterpillar Inc.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Industrials', industry: 'Farm & Heavy Construction Machinery', currency: 'USD' },
    { id: 'GE', name: 'General Electric Co.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Industrials', industry: 'Specialty Industrial Machinery', currency: 'USD' },
    { id: 'BA', name: 'Boeing Co.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Industrials', industry: 'Aerospace & Defense', currency: 'USD' },
    
    // Energy & Conglomerates
    { id: 'XOM', name: 'Exxon Mobil Corp.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Energy', industry: 'Oil & Gas Integrated', currency: 'USD' },
    { id: 'CVX', name: 'Chevron Corp.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Energy', industry: 'Oil & Gas Integrated', currency: 'USD' },
    { id: 'BRK-B', name: 'Berkshire Hathaway Inc.', assetType: 'STOCK', exchangeId: 'NYSE', sector: 'Financial Services', industry: 'Multi-Sector Holdings', currency: 'USD' },
    
    // Cryptocurrencies
    { id: 'BTC-USD', name: 'Bitcoin USD', assetType: 'CRYPTOCURRENCY', exchangeId: 'NASDAQ', sector: 'Cryptocurrency', industry: 'Digital Asset', currency: 'USD' },
    { id: 'ETH-USD', name: 'Ethereum USD', assetType: 'CRYPTOCURRENCY', exchangeId: 'NASDAQ', sector: 'Cryptocurrency', industry: 'Digital Asset', currency: 'USD' },
    { id: 'SOL-USD', name: 'Solana USD', assetType: 'CRYPTOCURRENCY', exchangeId: 'NASDAQ', sector: 'Cryptocurrency', industry: 'Digital Asset', currency: 'USD' },
  ];

  for (const tk of tickers) {
    await prisma.ticker.upsert({
      where: { id: tk.id },
      update: tk,
      create: tk,
    });
  }

  // 6. Seed Feature Flags
  console.log('Creating feature flags...');
  const flags = [
    { id: 'fractional_shares', enabled: true, description: 'Allow trading of fractional stock quantities' },
    { id: 'short_selling', enabled: false, description: 'Enable short selling positions' },
    { id: 'ai_insights', enabled: true, description: 'Display AI audit descriptions on portfolio allocations' },
  ];

  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { id: flag.id },
      update: { description: flag.description },
      create: flag,
    });
  }

  console.log('🌱 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
