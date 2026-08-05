import { prisma } from '@stock-market/database';
import { ConfigService } from '@stock-market/config';

ConfigService.getInstance();

async function run() {
  const tickers = await prisma.ticker.findMany();
  console.log(`Auditing ${tickers.length} tickers for providerSymbol cleanup...`);

  for (const t of tickers) {
    let cleanSymbol: string | null = null;
    
    if (t.providerSymbol && t.providerSymbol !== 'null') {
      cleanSymbol = t.providerSymbol;
    } else {
      // Fallback/Inference logic
      if (t.exchangeId === 'LSE' && !t.id.endsWith('.L')) {
        cleanSymbol = `${t.id}.L`;
      } else if ((t.exchangeId === 'NSI' || t.exchangeId === 'NSE') && !t.id.endsWith('.NS')) {
        cleanSymbol = `${t.id}.NS`;
      } else if (t.exchangeId === 'ASX' && !t.id.endsWith('.AX')) {
        cleanSymbol = `${t.id}.AX`;
      } else {
        cleanSymbol = t.id; // Just fallback to ticker ID
      }
    }

    await prisma.ticker.update({
      where: { id: t.id },
      data: { providerSymbol: cleanSymbol }
    });
  }
  console.log('Database cleanup of providerSymbols completed successfully!');
}

run().catch(console.error).finally(() => prisma.$disconnect());
