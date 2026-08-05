import { prisma } from '@stock-market/database';
import { ConfigService } from '@stock-market/config';

// Initialize config to load environment variables from .env file
ConfigService.getInstance();

async function run() {
  const barc = await prisma.ticker.findUnique({
    where: { id: 'BARC' }
  });
  console.log('BARC Ticker Record:', barc);
}

run().catch(console.error).finally(() => prisma.$disconnect());
