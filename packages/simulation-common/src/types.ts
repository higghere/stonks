export interface EconomyState {
  globalGdp: number;
  globalInflation: number;
  globalInterestRate: number;
  oilPrice: number;
  lithiumPrice: number;
  copperPrice: number;
  siliconPrice: number;
  steelPrice: number;
  electricityPrice: number;
  fearGreedIndex: number; // 0 to 100
  marketMomentum: number;
  speculationLevel: number;
  panicFactor: number;
}

export interface CountryState {
  code: string; // e.g. "USA", "IND", "CHN"
  gdp: number;
  inflation: number;
  interestRate: number;
  employmentRate: number;
  consumerConfidence: number;
  taxRate: number;
  currencyStrength: number;
  manufacturingSubsidy: number;
  tariffRate: Record<string, number>; // countryCode -> tariff rate
}

export interface IndustryState {
  name: string; // e.g. "Tech", "Semiconductors", "Automotive", "Retail", "Logistics"
  growthRate: number;
  demandIndex: number;
  supplyIndex: number;
  competitionIndex: number;
  averageMargin: number;
  innovationIndex: number;
}

export interface ProductState {
  id: string;
  name: string;
  tickerId: string;
  price: number;
  quality: number; // 0 to 100
  popularity: number; // 0 to 100
  reviewsRating: number; // 0 to 5
  margin: number;
  manufacturingCost: number;
  ageTicks: number;
  lifecycle: "STARTUP" | "GROWTH" | "MATURE" | "DECLINING" | "OBSOLETE";
  unitsSold: number;
  marketSegment: "BUDGET" | "MIDRANGE" | "PREMIUM" | "LUXURY";
}

export interface FactoryState {
  id: string;
  countryCode: string;
  capacity: number; // Max output units per tick
  efficiency: number; // 0.1 to 1.0 multiplier
  automation: number; // 0 to 100
  laborMorale: number; // 0 to 100
  powerCost: number;
}

export interface CompanyMemory {
  shortTerm: string[]; // decisions/events in last 30 ticks
  mediumTerm: string[]; // key events in last 365 ticks
  longTerm: string[]; // milestones that are never forgotten
}

export interface CompanyReputation {
  innovation: number; // 0 to 100
  quality: number;
  customerService: number;
  privacy: number;
  environmental: number;
  luxury: number;
  affordability: number;
  reliability: number;
}

export interface CompanyState {
  tickerId: string;
  lifecycle: "STARTUP" | "GROWTH" | "MATURE" | "DECLINING" | "BANKRUPT" | "ACQUIRED" | "LIQUIDATED";
  cash: number;
  debt: number;
  assetsValue: number;
  liabilitiesValue: number;
  cashFlow: number;
  employees: {
    engineering: number;
    marketing: number;
    sales: number;
    manufacturing: number;
    management: number;
    support: number;
  };
  factories: FactoryState[];
  products: ProductState[];
  marketShare: number;
  stockPrice: number;
  rdInvestment: number;
  brandEquity: number;
  technologyIndex: number;
  inventory: number;
  productionCapacity: number;
  reputation: CompanyReputation;
  employeeMorale: number; // 0 to 100
  customerLoyalty: number; // 0 to 100
  boardConfidence: number; // 0 to 100
  ceoApproval: number; // 0 to 100
  dividendPayoutRatio: number; // e.g. 0.20 for 20%
  memory: CompanyMemory;
  patentCount: number;
}

export interface GovernmentState {
  countryCode: string;
  stabilityIndex: number; // 0 to 100
  corruptionIndex: number;
  policyFocus: "INFRASTRUCTURE" | "MILITARY" | "WELFARE" | "TECH_SUBSIDY" | "FREE_TRADE";
  treasuryBalance: number;
  gdpMultiplier: number;
}

export interface ResourceNode {
  name: string; // e.g. "Lithium", "Copper", "Silicon"
  price: number;
  totalReserve: number;
  dailyConsumption: number;
  dailyProduction: number;
  scarcityFactor: number;
}

export interface ResourceNetwork {
  nodes: Record<string, ResourceNode>;
  dependencies: Record<string, string[]>; // e.g. "Battery" -> ["Lithium", "Cobalt"]
}

export interface DemographicState {
  globalPopulation: number;
  countryPopulations: Record<string, number>;
  averageDisposableIncome: Record<string, number>; // countryCode -> income
  consumerPreferences: {
    luxuryFocus: number; // 0 to 1
    techFocus: number;
    greenFocus: number;
  };
}

export interface TechnologyNode {
  id: string;
  name: string;
  unlocked: boolean;
  cost: number;
  prerequisites: string[];
}

export interface TechnologyTree {
  nodes: Record<string, TechnologyNode>;
}

export interface SimulationWorld {
  economy: EconomyState;
  countries: Record<string, CountryState>;
  industries: Record<string, IndustryState>;
  companies: Record<string, CompanyState>;
  governments: Record<string, GovernmentState>;
  resources: ResourceNetwork;
  psychology: {
    fear: number;
    greed: number;
    momentum: number;
    panic: number;
    trust: number;
  };
  technology: TechnologyTree;
  demographics: DemographicState;
  divergenceTree: string[]; // root causes of divergence
}

export interface CompanyDNA {
  innovation: number; // 0 to 1
  riskTolerance: number;
  marketingFocus: number;
  qualityFocus: number;
  costEfficiency: number;
  acquisitionLikelihood: number;
  employeeCare: number;
  bureaucracy: number;
  expansionFocus: number;
}

export interface CEOObjectives {
  primary: string;
  secondary: string;
  avoid: string;
}

export interface CompanyTemplate {
  tickerId: string;
  name: string;
  industry: string;
  country: string;
  dna: CompanyDNA;
  objectives: CEOObjectives;
  startingRelationships: {
    suppliers: string[];
    customers: string[];
    competitors: string[];
    partners: string[];
  };
}

export interface SimulationContext {
  world: SimulationWorld;
  tick: number;
  calendar: {
    date: Date;
    dayName: string;
    quarter: number;
    year: number;
    isQuarterEnd: boolean;
    isYearEnd: boolean;
  };
  random: () => number; // Deterministic PRNG seeded by simulation seed
  events: any[]; // Action and incident event queue
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string, err?: any) => void;
  };
}

export interface SimulationCommand {
  type: string; // e.g. "BUILD_FACTORY", "LAUNCH_PRODUCT"
  actorId: string;
  data: any;
  validate: (context: SimulationContext) => boolean;
  execute: (context: SimulationContext) => any;
}
