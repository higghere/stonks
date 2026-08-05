import { prisma } from '@stock-market/database';
import { ConfigService } from '@stock-market/config';

ConfigService.getInstance();

async function run() {
  const tickers = await prisma.ticker.findMany({
    orderBy: { id: 'asc' }
  });
  console.log('All Tickers in DB:');
  for (const t of tickers) {
    console.log(`- ID: ${t.id}, symbol: "${t.symbol}", providerSymbol: "${t.providerSymbol}", exchange: ${t.exchangeId}, currency: ${t.currency}`);
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
