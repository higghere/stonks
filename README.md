# Stock Market Paper Trading & Simulation Platform

A premium, state-of-the-art stock market paper trading application with two distinct runtime modes: **Real-World Live Market Mode** and **Alternate Reality Simulation Mode**. The platform is constructed as a modern TypeScript/Node.js monorepo featuring high-fidelity financial simulation models, AI-driven corporate decision-making engines, and real-time live market updates.

---

## 📌 Architecture & Technology Stack

The platform is designed around a monorepo structure using **npm Workspaces** to segregate business logic, utilities, databases, and application entry points.

```mermaid
graph TD
    Client[apps/web: Next.js Frontend] <-->|WebSockets / REST| API[apps/api: Express API Gateway]
    API <--> DB[(PostgreSQL Database)]
    API <--> Cache[(Redis Cache & BullMQ Queue)]
    
    subgraph Packages
        market[@stock-market/market] --> API
        sim_core[@stock-market/simulation-core] --> API
        sim_agents[@stock-market/simulation-agents] --> API
        db_pkg[@stock-market/database] --> DB
    end
```

### 💻 Technology Blueprint
1. **Core Runtime**: Node.js & TypeScript.
2. **Frontend Client (`apps/web`)**: Next.js 14 (App Router), React, Tailwind CSS, Lucide Icons, and lightweight chart visuals.
3. **Backend API Gateway (`apps/api`)**: Express.js with REST endpoints and WebSocket servers for live stream pricing updates.
4. **Database layer (`packages/database`)**: PostgreSQL database managed via **Prisma ORM**.
5. **Caching & Asynchronous Processing**: **Redis** serves as both an API caching layer and the broker for **BullMQ** background workers (performing catalog crawlers, asset enrichment queues, portfolio snapshot updates).

### 📁 Monorepo Folder Structure & Project Layout
```text
stock_Market/
├── apps/
│   ├── api/                   # Express.js backend API gateway and WebSocket server
│   └── web/                   # Next.js frontend client portal application
├── packages/
│   ├── auth/                  # JWT security and session encryption helpers
│   ├── charts/                # Client-side stock charts formatting modules
│   ├── config/                # Central TypeScript configurations and environment rules
│   ├── corporate-actions/     # Corporate stock splits, mergers, and dividends handlers
│   ├── database/              # Prisma schema definition, migration files, and database client
│   ├── logger/                # Winston unified debugger logger instance
│   ├── market/                # Live price providers (Yahoo Finance & Mock Brownian Walk)
│   ├── market-catalog/        # Active security listing registries and index databases
│   ├── notifications/         # Email delivery queue and user alert dispatchers
│   ├── orders/                # Transaction executor engine and orders matching validator
│   ├── portfolio/             # Position tracking and user balance valuation
│   ├── shared/                # Common utility tools and validation models
│   ├── simulation/            # REST routes and schema maps for alternate reality simulations
│   ├── simulation-agents/     # Heuristic AI CEO action score engines & Board Audits
│   ├── simulation-assets/     # Mock physical property and factories generators
│   ├── simulation-common/     # Shared types and state schemas for sandbox engines
│   ├── simulation-core/       # Commodity pricing, financials calculators, and stock valuation
│   ├── simulation-data/       # Default mock corporate profiles and seeding templates
│   ├── simulation-history/    # Stateful history logging for diverged timelines
│   ├── types/                 # Unified TypeScript interfaces and domain schemas
│   ├── ui/                    # Reusable React UI component libraries
│   ├── validation/            # Zod validation schemas
│   └── workers/               # BullMQ background processors (enrichment, portfolio crons)
├── package.json               # Root workspace composition configurations
└── tsconfig.json              # Base TypeScript configuration compiler settings
```

---

## 📊 Database Models & Schema Design

The Prisma schema (`packages/database/prisma/schema.prisma`) is segmented into Core Models and Alternate Reality Simulation Models.

### Core Models
* **User**: Profiles containing names, credentials (hashed), timezone, verification status, and settings.
* **Role & Permission**: Role-based access control (RBAC) mapping users to specific action permissions.
* **Account**: Financial ledger for the user containing cash balances, currency, and relations to order/transaction history.
* **Exchange**: Market exchanges (NASDAQ, NYSE, LSE, HKEX, NSE) with operational opening/closing times and currencies.
* **Ticker**: Market symbols (e.g. `AAPL`, `MSFT`) mapped to company listings and assets.
* **Position**: Tracks holdings (quantity and average cost basis) per user account.
* **Order & Execution**: Tracks transactional commands (BUY/SELL, LIMIT/MARKET/STOP) and matching executions.
* **Transaction & TransactionEntry**: Immutable double-entry financial bookkeeping tracking cash and stock movements.
* **Alert**: Real-time notifications triggered when stock prices cross target thresholds.
* **DiscoveryQueue & EnrichmentQueue**: Queues used by background workers to crawl and fetch asset metadata from live providers.

### Alternate Reality Simulation Models
* **Simulation**: Stateful sandbox records containing `worldState` (a JSON representing the simulated economy, commodity indexes, and statefully ticking companies).
* **SimulationPortfolio**: Replicates the core portfolio ledger inside the isolated sandbox.
* **SimulationPosition & SimulationOrder**: Tracks sandbox stock holdings and trades.
* **SimulationEvent**: Scheduled or randomized events (e.g. `FACTORY_FIRE`, `PATENT_LAWSUIT`, `CEO_FIRED`).
* **SimulationNews**: Dynamic generated newspapers indicating events and sentiment impact on tickers.

---

## 🌐 Live Market Quotes: Yahoo Finance API Integration

For the **Real-World Live Market Mode**, quotes are fetched on demand and cached:
* **Endpoints**: 
  - Chart & Price Quote: `https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d`
  - Asset Search: `https://query2.finance.yahoo.com/v1/finance/search?q={query}`
* **Provider Logic**: Found under `YahooFinanceProvider` inside `packages/market/src/providers/yahoo.provider.ts`.
* **Caching Strategy**: API queries check a local Redis cache before querying Yahoo Finance. Live tickers are updated via an intelligent polling cycle (`packages/market/src/services/market.service.ts`) and broadcasted to clients over WebSockets.
* **Fallback**: A `MockProvider` takes over automatically using realistic Brownian motion calculations if Yahoo Finance returns errors or rate-limits (HTTP 429).

---

## 🤖 Heuristic AI CEO & Board Audit Engine

In **Alternate Reality Simulation Mode**, companies do not merely drift randomly. Instead, they are run by individual **AI CEOs** whose decisions are monitored by a **Board of Directors**.

### 1. CEO Decision Algorithm (`packages/simulation-agents/src/ceo.ts`)
Each simulated company has a template DNA dictionary representing its personality profile:
```json
{
  "riskTolerance": 0.6,
  "innovation": 0.8,
  "costEfficiency": 0.5,
  "employeeCare": 0.7,
  "marketingFocus": 0.4,
  "expansionFocus": 0.6
}
```

The decision pipeline triggers each tick (representing an economy day):
1. **Problem Identification**: The engine reviews the company's financial state:
   - `cash < $2M` $\rightarrow$ Flag `LOW_LIQUIDITY`
   - `debt > cash * 1.5` $\rightarrow$ Flag `HIGH_LEVERAGE`
   - `marketShare < 15%` $\rightarrow$ Flag `LOW_MARKET_SHARE`
   - `technologyIndex < 50` $\rightarrow$ Flag `LOW_TECH`
2. **Action Drafting**: If flags are triggered, corresponding options are queued:
   - `LOW_LIQUIDITY` $\rightarrow$ `TAKE_LOAN`, `LAYOFFS`
   - `HIGH_LEVERAGE` $\rightarrow$ `REDUCE_DIVIDEND`, `REPAY_DEBT`
   - `LOW_MARKET_SHARE` $\rightarrow$ `INCREASE_MARKETING`, `LAUNCH_PRODUCT`
   - `LOW_TECH` $\rightarrow$ `INCREASE_RD`
   - *Fallback Actions*: `BUILD_FACTORY`, `INCREASE_MARKETING` (if no problems are identified).
3. **DNA Action Scoring**: The engine scores each option using the company's personality DNA:
   $$\text{Score} = (\text{expectedProfit} \times 100) - (\text{risk} \times 50 \times (1 - \text{riskTolerance})) + \sum \text{DNA\_Bonuses}$$
   - **R&D / Launch**: Bonus scaled by $\text{innovation} \times 30$
   - **Layoffs**: Bonus scaled by $\text{costEfficiency} \times 40$; penalty scaled by $\text{employeeCare} \times 30$
   - **Marketing**: Bonus scaled by $\text{marketingFocus} \times 30$
   - **Factory Expansion**: Bonus scaled by $\text{expansionFocus} \times 30$
   - **Affordability Check**: If an action costs more cash than available, a heavy penalty is applied unless `riskTolerance` is extremely high.
4. The action with the highest calculated score is chosen and dispatched for execution in the simulation state.

### 2. Board Audit & Performance Evaluation (`packages/simulation-agents/src/board.ts`)
A separate Board Audit script evaluates the CEO’s competence based on the company's financial direction:
* **Confidence Deterioration**:
  - Net negative cash flow $\rightarrow$ Deduct 5% from confidence.
  - Cash drops below \$500k $\rightarrow$ Deduct 15% from confidence.
  - Market share drops below 8% $\rightarrow$ Deduct 10% from confidence.
* **Confidence Recovery**:
  - Cash flow rises above \$2M $\rightarrow$ Add 2% to confidence.
* **CEO Dismissal**: If `boardConfidence` falls below **30%**, the Board of Directors fires the CEO. A new CEO is randomly selected, objectives and personality DNA are shuffled, and board confidence resets to **80%**.

---

## ⚙️ Simulation Core Algorithms

The core mechanics of the simulated economy are calculated daily via deterministic formulas (`packages/simulation-core`):

### 1. Macroeconomics Engine (`macro.ts`)
* **Commodity Price Scarcity Formula**:
  $$P_{new} = P_{old} \times \left(1 + \frac{\text{Demand} - \text{Supply}}{\text{Supply}} \times (0.5 \times \text{ScarcityFactor})\right)$$
* **Country GDP Growth**:
  $$\Delta \text{GDP} = 2\% + \frac{6 - \text{InterestRate}}{100} + \frac{\text{ConsumerConfidence} - 70}{300}$$
* **Inflation Pressure**: GDP growth pressures and oil price spikes increase inflation rates daily.
* **Currency Strength**: Increases with strong GDP growth and higher interest rates.

### 2. Financial Ledger Simulator (`financials.ts`)
Revenues and expenses are simulated daily:
* **Operating Revenue**: $\sum (\text{unitsSold} \times \text{productPrice})$
* **Cost of Goods Sold (COGS)**: $\sum (\text{unitsSold} \times \text{manufacturingCost})$
* **Salary Costs**: Daily salary rates calculated using a weighted matrix based on team structure:
  $$\text{Salary} = \frac{1}{365} \sum (\text{Employees}_{\text{Role}} \times \text{Salary}_{\text{Role}})$$
  *(Roles: Management: \$150k, Engineering: \$120k, Support: \$50k, Sales: \$70k, Manufacturing: \$40k)*
* **Asset Value Estimation**: Calculated using cash-on-hand, inventory value, and factory depreciations:
  $$\text{Assets} = \text{Cash} + \text{Inventory} + \sum (\$1\text{M} \times \text{FactoryEfficiency})$$

### 3. Market Share & Competitiveness (`competition.ts`)
Redistribution of industry market shares is calculated using consumer preferences:
1. **Competitiveness Score**:
   $$\text{Score} = \left(\text{Quality} \times \text{Weight}_{\text{Quality}} + \frac{1000}{\text{Price}} \times \text{Weight}_{\text{Price}} + \text{Reputation} \times \text{Weight}_{\text{Brand}}\right) \times \frac{\text{Popularity}}{100} \times \text{AgePenalty}$$
2. **Market Share Redistribution**:
   $$\text{Market Share}_{\text{Product}} = \frac{\text{Score}_{\text{Product}}}{\sum \text{Scores}_{\text{Industry}}}$$

### 4. Stock Price Valuation Model (`pricing.ts`)
A blended valuation formula maps company performance directly to its stock ticker price:
1. **Book Value**: $\text{Assets} - \text{Liabilities}$
2. **Earnings Proxy**: Cash flow generated.
3. **Multiples Escalation**: Baseline multiples ($PE = 15$, $PB = 1.5$) are raised by Tech Indexes and Brand Equity:
   $$\text{PE}_{\text{adjusted}} = 15 \times \left(1 + \frac{\text{BrandEquity}}{500}\right) \times \left(1 + \frac{\text{TechIndex}}{300}\right)$$
4. **Market Psychology Shifts**: Adjusts multiples based on fear/greed sentiment, momentum, and panic factors:
   - Fear/Greed adjusts multiples by up to $\pm 40\%$.
   - Panic Factor contracts multiples by up to $60\%$.
5. **Weighted Valuation**:
   $$\text{Valuation} = 70\% \times (\text{Earnings} \times \text{PE}_{\text{adjusted}}) + 30\% \times (\text{Book Value} \times \text{PB}_{\text{adjusted}})$$
6. **Share Price**:
   $$\text{Stock Price} = \frac{\text{Valuation}}{10,000,000} \times \text{LifecycleMultiplier}$$
   *(Lifecycle multipliers: Startup: 1.2, Growth: 1.5, Declining: 0.4)*

---

## 🚀 Setup & Execution Guide

### Prerequisites
* **Node.js** (v18+)
* **PostgreSQL Database**
* **Redis Server**

### Step-by-Step Installation
1. **Clone and Install Dependencies**:
   ```bash
   git clone <repository-url>
   cd stock_Market
   npm install
   ```

2. **Configure Environment Variables**:
   Create a `.env` file in the root directory (based on `.env.example`):
   ```env
   DATABASE_URL="postgresql://username:password@localhost:5432/stockmarket"
   REDIS_URL="redis://localhost:6379"
   JWT_SECRET="your-super-secret-jwt-key"
   PORT=4000
   ```

3. **Database Schema Initialization**:
   ```bash
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

4. **Compile the Project**:
   ```bash
   npm run build
   ```

5. **Start Redis Server**:
   Make sure Redis is running locally on port `6379`.

6. **Launch Applications**:
   ```bash
   npm run start
   ```
   * Access the Next.js frontend application at [http://localhost:3000](http://localhost:3000)
   * The API server will be online at [http://localhost:4000](http://localhost:4000)
