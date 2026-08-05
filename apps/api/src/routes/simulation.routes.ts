import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '@stock-market/database';
import { Logger } from '@stock-market/logger';
import { authMiddleware } from '../middlewares/auth.middleware';
import { simulationService } from '@stock-market/simulation';

const router = Router();

// Helper to find or create a simulation portfolio
async function getOrCreatePortfolio(simulationId: string, userId: string) {
  let portfolio = await prisma.simulationPortfolio.findFirst({
    where: { simulationId, userId },
    include: { positions: true }
  });
  if (!portfolio) {
    portfolio = await prisma.simulationPortfolio.create({
      data: {
        simulationId,
        userId,
        cashBalance: 100000.0,
      },
      include: { positions: true }
    });
  }
  return portfolio;
}

// Secure all simulation endpoints
router.use(authMiddleware);

// POST /api/v1/simulation - Create a new simulation save
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { name, difficulty } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    // Seeding simulation with current real-world Yahoo Finance prices
    const initialPrices: Record<string, number> = {};
    try {
      const { MarketService } = await import('@stock-market/market');
      const { COMPANY_TEMPLATES } = await import('@stock-market/simulation-data');
      const marketService = MarketService.getInstance();
      
      for (const ticker of Object.keys(COMPANY_TEMPLATES)) {
        try {
          const quote = await marketService.getQuote(ticker);
          initialPrices[ticker] = quote.price;
        } catch (err) {
          Logger.warn(`[SIMULATION CREATE] Failed to fetch starting price for ${ticker}`, err);
          initialPrices[ticker] = 100.0;
        }
      }
    } catch (err) {
      Logger.error(`[SIMULATION CREATE] Failed to load market service or templates for seeding`, err);
    }

    const sim = await simulationService.createSimulation(
      userId,
      name,
      difficulty || 'NORMAL',
      initialPrices
    );

    res.json({ success: true, simulation: sim });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/simulation - List all simulation saves of the user
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const saves = await prisma.simulation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ success: true, saves });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/simulation/:id - Load specific save state details
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const sim = await prisma.simulation.findFirst({
      where: { id, userId },
    });

    if (!sim) {
      return res.status(404).json({ success: false, message: 'Simulation not found' });
    }

    res.json({ success: true, simulation: sim });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/simulation/:id/tick - Trigger daily advance cycle tick
router.post('/:id/tick', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const simCheck = await prisma.simulation.findFirst({
      where: { id, userId },
    });

    if (!simCheck) {
      return res.status(404).json({ success: false, message: 'Simulation not found' });
    }

    const updated = await simulationService.tickSimulation(id);

    res.json({ success: true, simulation: updated });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/simulation/:id/portfolio - Get portfolio cash balance and positions enriched with simulation company prices
router.get('/:id/portfolio', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { id: simulationId } = req.params;
    
    const sim = await prisma.simulation.findUnique({ where: { id: simulationId } });
    if (!sim) {
      return res.status(404).json({ success: false, message: 'Simulation not found' });
    }
    
    const world = typeof sim.worldState === 'string' ? JSON.parse(sim.worldState) : sim.worldState;
    const companies = world?.companies || {};
    
    const portfolio = await getOrCreatePortfolio(simulationId, userId);
    
    const enrichedPositions = portfolio.positions.map((pos) => {
      const company = companies[pos.tickerId];
      const currentPrice = company ? parseFloat(company.stockPrice) : pos.averagePrice.toNumber();
      const qty = pos.quantity.toNumber();
      const avgPrice = pos.averagePrice.toNumber();
      const marketValue = qty * currentPrice;
      const unrealizedPl = marketValue - (qty * avgPrice);
      const unrealizedPlPercent = avgPrice > 0 ? (unrealizedPl / (qty * avgPrice)) * 100 : 0;
      
      return {
        id: pos.id,
        portfolioId: pos.portfolioId,
        tickerId: pos.tickerId,
        quantity: qty,
        averagePrice: avgPrice,
        currentPrice,
        marketValue,
        unrealizedPl,
        unrealizedPlPercent,
        name: company?.name || `${pos.tickerId} Corp.`,
      };
    });
    
    const totalMarketValue = enrichedPositions.reduce((acc, p) => acc + p.marketValue, 0);
    const cashBalance = portfolio.cashBalance.toNumber();
    const totalPortfolioValue = cashBalance + totalMarketValue;
    
    res.json({
      success: true,
      data: {
        account: {
          id: portfolio.id,
          cashBalance,
          totalMarketValue,
          totalPortfolioValue,
        },
        positions: enrichedPositions,
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/simulation/:id/tickers - List simulated tickers
router.get('/:id/tickers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: simulationId } = req.params;
    const query = req.query.q as string;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const skip = (page - 1) * limit;

    const sim = await prisma.simulation.findUnique({ where: { id: simulationId } });
    if (!sim) {
      return res.status(404).json({ success: false, message: 'Simulation not found' });
    }
    
    const world = typeof sim.worldState === 'string' ? JSON.parse(sim.worldState) : sim.worldState;
    const companies = world?.companies || {};
    
    let tickersList;
    if (query && query.trim().length > 0) {
      const { SearchService } = await import('@stock-market/market');
      tickersList = await SearchService.getInstance().search(query, skip, limit);
    } else {
      tickersList = await prisma.ticker.findMany({
        where: { isActive: true },
        orderBy: [
          { isVerified: 'desc' },
          { id: 'asc' }
        ],
        skip,
        take: limit,
      });
    }

    const { MarketService } = await import('@stock-market/market');
    const marketService = MarketService.getInstance();

    const enrichedTickers = await Promise.all(
      tickersList.map(async (t: any) => {
        const simCompany = companies[t.id];
        if (simCompany) {
          return {
            id: t.id,
            symbol: t.id,
            name: t.name,
            assetType: t.assetType || 'STOCK',
            exchangeId: t.exchangeId || 'NASDAQ',
            sector: t.sector,
            industry: t.industry,
            currency: t.currency || 'USD',
            price: parseFloat(simCompany.stockPrice),
            change: 0,
            changePercent: 0,
            isSimulated: true,
          };
        }

        try {
          const quote = await marketService.getQuote(t.id);
          return {
            id: t.id,
            symbol: t.id,
            name: t.name,
            assetType: t.assetType || 'STOCK',
            exchangeId: t.exchangeId || 'NASDAQ',
            sector: t.sector,
            industry: t.industry,
            currency: t.currency || 'USD',
            price: quote.price,
            change: quote.change,
            changePercent: quote.changePercent,
            isSimulated: false,
          };
        } catch {
          return {
            id: t.id,
            symbol: t.id,
            name: t.name,
            assetType: t.assetType || 'STOCK',
            exchangeId: t.exchangeId || 'NASDAQ',
            sector: t.sector,
            industry: t.industry,
            currency: t.currency || 'USD',
            price: 100.0,
            change: 0,
            changePercent: 0,
            isSimulated: false,
          };
        }
      })
    );

    res.json({
      success: true,
      tickers: enrichedTickers,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/simulation/:id/stock/:ticker - Get quote details for simulated company with real-world fallback
router.get('/:id/stock/:ticker', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: simulationId, ticker } = req.params;
    const sym = ticker.toUpperCase().trim();
    
    const sim = await prisma.simulation.findUnique({ where: { id: simulationId } });
    if (!sim) {
      return res.status(404).json({ success: false, message: 'Simulation not found' });
    }
    
    const world = typeof sim.worldState === 'string' ? JSON.parse(sim.worldState) : sim.worldState;
    const company = world?.companies?.[sym];
    
    if (company) {
      const price = parseFloat(company.stockPrice);
      return res.json({
        success: true,
        data: {
          isSimulated: true,
          profile: {
            ticker: sym,
            name: company.name || `${sym} Corp.`,
            exchange: 'NASDAQ',
            sector: company.sector || 'Technology',
            industry: company.industry || 'Hardware',
            currency: 'USD',
            marketCap: company.marketCap || 150000000000,
            peRatio: company.peRatio || 22.5,
            eps: company.eps || 4.25,
            dividendYield: company.dividendYield || 1.25,
            beta: company.beta || 1.15,
            high52Week: company.high52Week || (price * 1.25),
            low52Week: company.low52Week || (price * 0.75),
            description: company.description || `${company.name || sym} is a dynamically generated simulated company operating in the ${company.sector || 'Technology'} sector inside this sandbox trading universe.`,
            logo: '',
          },
          quote: {
            price,
            change: 0,
            changePercent: 0,
            high: price,
            low: price,
            open: price,
            previousClose: price,
          },
          session: {
            isOpen: true,
            nextOpen: new Date().toISOString(),
            nextClose: new Date().toISOString(),
          }
        }
      });
    }

    // Ticker is NOT stateful in simulation: return real-world quote/profile/session!
    try {
      const { MarketService, ExchangeService } = await import('@stock-market/market');
      const marketService = MarketService.getInstance();
      const exchangeService = ExchangeService.getInstance();
      
      const profile = await marketService.getCompanyProfile(sym);
      const [quote, session] = await Promise.all([
        marketService.getQuote(sym),
        exchangeService.getSessionInfo(profile.exchange),
      ]);
      
      res.json({
        success: true,
        data: {
          isSimulated: false,
          profile,
          quote,
          session,
        }
      });
    } catch (err) {
      res.status(404).json({ success: false, message: `Ticker ${sym} not found` });
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/simulation/:id/orders - Place simulation order with slow execution delay
router.post('/:id/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { id: simulationId } = req.params;
    const { tickerId, side, type, quantity } = req.body;
    
    const sym = tickerId.toUpperCase().trim();
    
    const sim = await prisma.simulation.findUnique({ where: { id: simulationId } });
    if (!sim) {
      return res.status(404).json({ success: false, message: 'Simulation not found' });
    }
    
    const world = typeof sim.worldState === 'string' ? JSON.parse(sim.worldState) : sim.worldState;
    world.companies = world.companies || {};
    
    let company = world.companies[sym];
    if (!company) {
      // 1. Fetch the target ticker to identify its sector/industry
      const targetTicker = await prisma.ticker.findUnique({ where: { id: sym } });
      if (!targetTicker) {
        return res.status(400).json({ success: false, message: `Stock ${sym} is not active in the trading universe` });
      }
      
      const sector = targetTicker.sector || 'Technology';
      
      // 2. Fetch all active tickers belonging to the same sector
      const relatedTickers = await prisma.ticker.findMany({
        where: { sector, isActive: true }
      });
      
      Logger.info(`[SIMULATION ORDER] Importing sector "${sector}" (${relatedTickers.length} companies) into simulation save ${simulationId} due to trade on ${sym}`);
      
      const { MarketService } = await import('@stock-market/market');
      const marketService = MarketService.getInstance();
      
      // 3. Seed each company in the sector with its current real-world quote
      for (const t of relatedTickers) {
        try {
          const quote = await marketService.getQuote(t.id);
          world.companies[t.id] = {
            tickerId: t.id,
            lifecycle: 'GROWTH',
            cash: 50000000,
            debt: 10000000,
            assetsValue: 60000000,
            liabilitiesValue: 10000000,
            cashFlow: 5000000,
            employees: {
              management: 50,
              engineering: 150,
              marketing: 100,
              sales: 100,
              support: 80,
              manufacturing: 500,
            },
            factories: [
              {
                id: `f-${t.id}-0`,
                countryCode: t.country || 'USA',
                capacity: 50000,
                efficiency: 1.0,
                automation: 40,
                laborMorale: 90,
                powerCost: 0.10,
              },
            ],
            products: [
              {
                id: `p-${t.id}-0`,
                name: `${t.name} Product Alpha`,
                tickerId: t.id,
                price: 699,
                quality: 75,
                popularity: 80,
                reviewsRating: 4.2,
                margin: 300,
                manufacturingCost: 399,
                ageTicks: 0,
                lifecycle: 'STARTUP',
                unitsSold: 0,
                marketSegment: 'MIDRANGE',
              },
            ],
            marketShare: 0.33,
            stockPrice: quote.price,
            rdInvestment: 5000000,
            brandEquity: 80,
            technologyIndex: 60,
            inventory: 10000,
            productionCapacity: 50000,
            reputation: {
              innovation: 50,
              quality: 50,
              customerService: 80,
              privacy: 90,
              environmental: 75,
            },
            competitorMemory: {},
          };
        } catch (err) {
          Logger.warn(`[SIMULATION ORDER] Failed to fetch starting price for imported ticker ${t.id}, seeding fallback $100`, err);
          world.companies[t.id] = {
            tickerId: t.id,
            lifecycle: 'GROWTH',
            cash: 50000000,
            debt: 10000000,
            assetsValue: 60000000,
            liabilitiesValue: 10000000,
            cashFlow: 5000000,
            employees: { management: 50, engineering: 150, marketing: 100, sales: 100, support: 80, manufacturing: 500 },
            factories: [{ id: `f-${t.id}-0`, countryCode: t.country || 'USA', capacity: 50000, efficiency: 1.0, automation: 40, laborMorale: 90, powerCost: 0.10 }],
            products: [{ id: `p-${t.id}-0`, name: `${t.name} Product Alpha`, tickerId: t.id, price: 699, quality: 75, popularity: 80, reviewsRating: 4.2, margin: 300, manufacturingCost: 399, ageTicks: 0, lifecycle: 'STARTUP', unitsSold: 0, marketSegment: 'MIDRANGE' }],
            marketShare: 0.33,
            stockPrice: 100.0,
            rdInvestment: 5000000,
            brandEquity: 80,
            technologyIndex: 60,
            inventory: 10000,
            productionCapacity: 50000,
            reputation: { innovation: 50, quality: 50, customerService: 80, privacy: 90, environmental: 75 },
            competitorMemory: {},
          };
        }
      }
      
      // Update simulation save record
      await prisma.simulation.update({
        where: { id: simulationId },
        data: { worldState: world }
      });
      
      company = world.companies[sym];
    }
    
    const currentPrice = parseFloat(company.stockPrice);
    const portfolio = await getOrCreatePortfolio(simulationId, userId);
    
    const commission = 2.00;
    const totalCost = quantity * currentPrice;
    
    if (side === 'BUY') {
      const needed = totalCost + commission;
      if (portfolio.cashBalance.toNumber() < needed) {
        return res.status(400).json({ success: false, message: 'Insufficient cash balance for simulated order' });
      }
    } else {
      const pos = portfolio.positions.find((p) => p.tickerId === sym);
      if (!pos || pos.quantity.toNumber() < quantity) {
        return res.status(400).json({ success: false, message: 'Insufficient shares to sell' });
      }
    }
    
    const order = await prisma.simulationOrder.create({
      data: {
        portfolioId: portfolio.id,
        tickerId: sym,
        side,
        type,
        status: 'PENDING',
        quantity: quantity,
        price: currentPrice,
      }
    });
    
    // Simulate SLOW execution: we trigger execution in the background after 5 seconds!
    setTimeout(async () => {
      try {
        await prisma.$transaction(async (tx) => {
          const dbOrder = await tx.simulationOrder.findUnique({ where: { id: order.id } });
          if (!dbOrder || dbOrder.status !== 'PENDING') return;
          
          const dbPortfolio = await tx.simulationPortfolio.findUnique({
            where: { id: portfolio.id },
            include: { positions: true }
          });
          if (!dbPortfolio) return;
          
          let newCash = dbPortfolio.cashBalance.toNumber();
          const commissionDecimal = 2.00;
          const executionCost = quantity * currentPrice;
          
          if (side === 'BUY') {
            newCash = newCash - executionCost - commissionDecimal;
            
            const existingPos = dbPortfolio.positions.find((p) => p.tickerId === sym);
            if (existingPos) {
              const oldQty = existingPos.quantity.toNumber();
              const oldPrice = existingPos.averagePrice.toNumber();
              const newQty = oldQty + quantity;
              const newAvgPrice = ((oldPrice * oldQty) + (currentPrice * quantity)) / newQty;
              
              await tx.simulationPosition.update({
                where: { id: existingPos.id },
                data: {
                  quantity: newQty,
                  averagePrice: newAvgPrice
                }
              });
            } else {
              await tx.simulationPosition.create({
                data: {
                  portfolioId: dbPortfolio.id,
                  tickerId: sym,
                  quantity: quantity,
                  averagePrice: currentPrice
                }
              });
            }
          } else {
            newCash = newCash + executionCost - commissionDecimal;
            
            const existingPos = dbPortfolio.positions.find((p) => p.tickerId === sym);
            if (existingPos) {
              const newQty = existingPos.quantity.toNumber() - quantity;
              if (newQty <= 0) {
                await tx.simulationPosition.delete({ where: { id: existingPos.id } });
              } else {
                await tx.simulationPosition.update({
                  where: { id: existingPos.id },
                  data: { quantity: newQty }
                });
              }
            }
          }
          
          await tx.simulationPortfolio.update({
            where: { id: dbPortfolio.id },
            data: { cashBalance: newCash }
          });
          
          await tx.simulationOrder.update({
            where: { id: order.id },
            data: { status: 'FILLED' }
          });
          
          Logger.info(`[SIMULATION ORDER] Slow order ${order.id} executed successfully after 5s delay`);
        });
      } catch (err) {
        Logger.error(`[SIMULATION ORDER] Failed to process slow execution for order ${order.id}`, err);
        await prisma.simulationOrder.update({
          where: { id: order.id },
          data: { status: 'REJECTED' }
        });
      }
    }, 5000); // 5000ms delay to make it happen slowly
    
    res.status(201).json({ success: true, orderId: order.id, status: 'PENDING' });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/simulation/:id/orders - List simulation orders
router.get('/:id/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { id: simulationId } = req.params;
    
    const portfolio = await getOrCreatePortfolio(simulationId, userId);
    
    const orders = await prisma.simulationOrder.findMany({
      where: { portfolioId: portfolio.id },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json({
      success: true,
      orders,
    });
  } catch (err) {
    next(err);
  }
});

export const simulationRoutes = router;
export default simulationRoutes;
