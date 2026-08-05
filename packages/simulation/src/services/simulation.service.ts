import { PrismaClient } from '@stock-market/database';
import { Logger } from '@stock-market/logger';
import { 
  SimulationWorld, 
  SimulationContext, 
  getMulberry32,
  CompanyState,
  ProductState
} from '@stock-market/simulation-common';
import { 
  COMPANY_TEMPLATES, 
  COUNTRY_PRESETS, 
  INDUSTRY_PRESETS, 
  STARTING_RESOURCES, 
  STARTING_TECH_TREE 
} from '@stock-market/simulation-data';
import { 
  calculateStockPrice, 
  resolveMarketShares, 
  calculateCompanyFinancials, 
  simulateCountryEconomy, 
  calculateCommodityPrice 
} from '@stock-market/simulation-core';
import { decideCEOAction, auditCEOPerformance, updateCompanyMemory } from '@stock-market/simulation-agents';
import { calculateDivergenceScore } from '@stock-market/simulation-history';
import { eventBus } from '../engine/event-bus';
import { advanceCalendar } from '../engine/scheduler';

const prisma = new PrismaClient();

// ==========================================
// REGISTER CORE ECONOMIC SYSTEMS
// ==========================================

// 1. Daily Production & Resource consumption
eventBus.subscribe('DailyTick', (context) => {
  const world = context.world;
  for (const company of Object.values(world.companies) as CompanyState[]) {
    if (company.lifecycle === 'BANKRUPT' || company.lifecycle === 'LIQUIDATED') continue;

    // Factory production
    const factoryCount = company.factories.length;
    const capacity = factoryCount * 50000; // e.g. 50k units per factory
    company.productionCapacity = capacity;

    // Consume raw materials (e.g. Lithium and Silicon)
    // Reduce reserves
    const silicon = world.resources.nodes['Silicon'];
    const lithium = world.resources.nodes['Lithium'];
    
    if (silicon) {
      silicon.dailyConsumption += factoryCount * 200;
    }
    if (lithium && company.tickerId === 'TSLA') {
      lithium.dailyConsumption += factoryCount * 800;
    }

    // Output production inventory
    company.inventory += capacity * 0.9;
  }
});

// 2. Daily Competition, Pricing, and Stock Prices updates
eventBus.subscribe('DailyTick', (context) => {
  const world = context.world;

  // Resolve competition market shares for products
  const techProducts: { product: ProductState; reputation: any }[] = [];
  
  for (const company of Object.values(world.companies) as CompanyState[]) {
    if (company.lifecycle === 'BANKRUPT' || company.lifecycle === 'LIQUIDATED') continue;
    for (const prod of company.products) {
      techProducts.push({ product: prod, reputation: company.reputation });
    }
  }

  // Segment allocations (Luxury Focus vs Tech Focus)
  const shares = resolveMarketShares(techProducts, { priceWeight: 0.4, qualityWeight: 0.5, brandWeight: 0.3 });
  
  // Apply units sold
  for (const item of techProducts) {
    const share = shares[item.product.id] || 0;
    item.product.unitsSold = Math.floor(share * 200000); // 200k daily units total
    
    // Decrement inventory
    const parent = world.companies[item.product.tickerId] as CompanyState;
    if (parent) {
      parent.inventory = Math.max(0, parent.inventory - item.product.unitsSold);
    }
  }

  // Update Country GDPs and Commodity Prices
  for (const [code, country] of Object.entries(world.countries)) {
    world.countries[code] = simulateCountryEconomy(country as any, world.economy);
  }

  for (const [name, resource] of Object.entries(world.resources.nodes)) {
    world.resources.nodes[name].price = calculateCommodityPrice(resource as any);
  }

  // Calculate Company Financials
  for (const company of Object.values(world.companies) as CompanyState[]) {
    if (company.lifecycle === 'BANKRUPT' || company.lifecycle === 'LIQUIDATED') continue;
    
    const country = world.countries[COMPANY_TEMPLATES[company.tickerId]?.country || 'USA'] || world.countries['USA'];
    const financials = calculateCompanyFinancials(company, country as any);
    
    company.cash = financials.cash;
    company.debt = financials.debt;
    company.assetsValue = financials.assetsValue;
    company.liabilitiesValue = financials.liabilitiesValue;
    company.cashFlow = financials.cashFlow;

    // Recalculate stock price
    company.stockPrice = calculateStockPrice(company, world.economy);

    // AI CEO heuristic decisions check
    if (context.tick % 7 === 0) {
      const decision = decideCEOAction(company, context);
      if (decision) {
        // Execute action effects immediately
        if (decision.actionName === 'TAKE_LOAN') {
          company.cash += 5000000;
          company.debt += 5000000;
        } else if (decision.actionName === 'LAYOFFS') {
          company.employees.manufacturing = Math.max(10, company.employees.manufacturing - 100);
          company.employeeMorale = Math.max(0, company.employeeMorale - 15);
        } else if (decision.actionName === 'INCREASE_RD') {
          company.cash -= 3000000;
          company.technologyIndex += 10;
        } else if (decision.actionName === 'BUILD_FACTORY') {
          company.cash -= 8000000;
          company.factories.push({
            id: `f-${company.tickerId}-${company.factories.length}`,
            countryCode: 'USA',
            capacity: 50000,
            efficiency: 1.0,
            automation: 50,
            laborMorale: 85,
            powerCost: 0.12,
          });
        }
        
        company.memory.shortTerm.push(`Executed action ${decision.actionName} with budget $${decision.parameters.budget}`);
      }
    }
  }
});

// 3. Quarterly Audits (Board reviews)
eventBus.subscribe('QuarterlyTick', (context) => {
  const world = context.world;
  for (const company of Object.values(world.companies) as CompanyState[]) {
    if (company.lifecycle === 'BANKRUPT' || company.lifecycle === 'LIQUIDATED') continue;
    
    const audit = auditCEOPerformance(company);
    world.companies[company.tickerId] = audit.company;
    
    // Decay memory
    world.companies[company.tickerId] = updateCompanyMemory(audit.company);
  }
});

export class SimulationService {
  /**
   * Initializes a brand new Simulation save state.
   */
  public async createSimulation(
    userId: string, 
    name: string, 
    difficulty: string,
    initialPrices?: Record<string, number>
  ): Promise<any> {
    const seed = Math.random().toString(36).substring(7);
    
    // 1. Compile Starting world state
    const companies: Record<string, CompanyState> = {};
    for (const [ticker, template] of Object.entries(COMPANY_TEMPLATES)) {
      const startingPrice = initialPrices && initialPrices[ticker] ? initialPrices[ticker] : 100.0;
      companies[ticker] = {
        tickerId: ticker,
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
            id: `f-${ticker}-0`,
            countryCode: template.country,
            capacity: 50000,
            efficiency: 1.0,
            automation: 40,
            laborMorale: 90,
            powerCost: 0.10,
          },
        ],
        products: [
          {
            id: `p-${ticker}-0`,
            name: `${template.name} Phone Alpha`,
            tickerId: ticker,
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
        stockPrice: startingPrice,
        rdInvestment: 5000000,
        brandEquity: 80,
        technologyIndex: 60,
        inventory: 10000,
        productionCapacity: 50000,
        reputation: {
          innovation: template.dna.innovation * 100,
          quality: template.dna.qualityFocus * 100,
          customerService: 80,
          privacy: 90,
          environmental: 75,
          luxury: template.dna.qualityFocus * 90,
          affordability: 50,
          reliability: 85,
        },
        employeeMorale: 85,
        customerLoyalty: 80,
        boardConfidence: 90,
        ceoApproval: 85,
        dividendPayoutRatio: 0.10,
        memory: { shortTerm: [], mediumTerm: [], longTerm: [] },
        patentCount: 3,
      };
    }

    const world: SimulationWorld = {
      economy: {
        globalGdp: 85000000000000,
        globalInflation: 0.03,
        globalInterestRate: 0.04,
        oilPrice: 75.0,
        lithiumPrice: 150.0,
        copperPrice: 4.20,
        siliconPrice: 25.0,
        steelPrice: 600.0,
        electricityPrice: 0.12,
        fearGreedIndex: 50,
        marketMomentum: 0.0,
        speculationLevel: 1.0,
        panicFactor: 0.0,
      },
      countries: COUNTRY_PRESETS as any,
      industries: INDUSTRY_PRESETS,
      companies,
      governments: {},
      resources: STARTING_RESOURCES,
      psychology: {
        fear: 50,
        greed: 50,
        momentum: 0,
        panic: 0,
        trust: 80,
      },
      technology: STARTING_TECH_TREE,
      demographics: {
        globalPopulation: 8000000000,
        countryPopulations: { USA: 330000000, IND: 1400000000, CHN: 1400000000 },
        averageDisposableIncome: { USA: 55000, IND: 8000, CHN: 15000 },
        consumerPreferences: { luxuryFocus: 0.3, techFocus: 0.6, greenFocus: 0.4 },
      },
      divergenceTree: ['Timeline Initialized: Practice trading decoupled.'],
    };

    // 2. Save to database
    return await prisma.simulation.create({
      data: {
        userId,
        name,
        difficulty,
        seed,
        status: 'ACTIVE',
        divergenceScore: 0.0,
        worldState: JSON.stringify(world), // Postgres handles structured Json column
      },
    });
  }

  /**
   * Executes a daily tick cycle on the active save file.
   */
  public async tickSimulation(id: string): Promise<any> {
    const sim = await prisma.simulation.findUnique({ where: { id } });
    if (!sim) throw new Error('Simulation save file not found');

    const world = (typeof sim.worldState === 'string' ? JSON.parse(sim.worldState) : sim.worldState) as SimulationWorld;
    
    // Create Context
    const context: SimulationContext = {
      world,
      tick: sim.tickNumber,
      calendar: {
        date: new Date(2027, 0, 1),
        dayName: 'Friday',
        quarter: 1,
        year: 2027,
        isQuarterEnd: false,
        isYearEnd: false,
      },
      random: getMulberry32(sim.seed),
      events: [],
      logger: {
        info: (msg) => Logger.info(msg),
        warn: (msg) => Logger.warn(msg),
        error: (msg) => Logger.error(msg),
      },
    };

    // Advance clocks
    const updatedContext = advanceCalendar(context);
    
    // Recalculate divergence
    const div = calculateDivergenceScore(updatedContext.world);

    // Save back
    return await prisma.simulation.update({
      where: { id },
      data: {
        tickNumber: updatedContext.tick,
        divergenceScore: div,
        worldState: updatedContext.world as any,
      },
    });
  }
}
export const simulationService = new SimulationService();
