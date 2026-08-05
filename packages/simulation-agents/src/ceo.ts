import { CompanyState, SimulationContext } from '@stock-market/simulation-common';
import { COMPANY_TEMPLATES } from '@stock-market/simulation-data';

interface HeuristicAction {
  name: string;
  expectedProfit: number; // -1.0 to 1.0
  risk: number; // 0.0 to 1.0
  cashCost: number;
  moraleImpact: number;
}

/**
 * AI CEO Heuristic Engine that evaluates company state and returns the optimal business action command.
 */
export function decideCEOAction(
  company: CompanyState,
  context: SimulationContext
): { actionName: string; parameters: any } | null {
  const template = COMPANY_TEMPLATES[company.tickerId];
  if (!template) return null;

  const dna = template.dna;
  const problems: string[] = [];

  // 1. Identify current business problems
  if (company.cash < 2000000) {
    problems.push('LOW_LIQUIDITY');
  }
  if (company.debt > company.cash * 1.5) {
    problems.push('HIGH_LEVERAGE');
  }
  if (company.marketShare < 0.15) {
    problems.push('LOW_MARKET_SHARE');
  }
  if (company.technologyIndex < 50) {
    problems.push('LOW_TECH');
  }

  // 2. Draft possible actions based on identified problems
  const actionsList: HeuristicAction[] = [];

  if (problems.includes('LOW_LIQUIDITY')) {
    actionsList.push({ name: 'TAKE_LOAN', expectedProfit: 0.1, risk: 0.5, cashCost: -5000000, moraleImpact: 0 });
    actionsList.push({ name: 'LAYOFFS', expectedProfit: 0.4, risk: 0.2, cashCost: 500000, moraleImpact: -20 });
  }
  if (problems.includes('HIGH_LEVERAGE')) {
    actionsList.push({ name: 'REDUCE_DIVIDEND', expectedProfit: 0.3, risk: 0.1, cashCost: 1000000, moraleImpact: 0 });
    actionsList.push({ name: 'REPAY_DEBT', expectedProfit: 0.2, risk: 0.0, cashCost: 2000000, moraleImpact: 0 });
  }
  if (problems.includes('LOW_MARKET_SHARE')) {
    actionsList.push({ name: 'INCREASE_MARKETING', expectedProfit: 0.5, risk: 0.3, cashCost: 1500000, moraleImpact: 0 });
    actionsList.push({ name: 'LAUNCH_PRODUCT', expectedProfit: 0.8, risk: 0.6, cashCost: 5000000, moraleImpact: 5 });
  }
  if (problems.includes('LOW_TECH')) {
    actionsList.push({ name: 'INCREASE_RD', expectedProfit: 0.6, risk: 0.4, cashCost: 3000000, moraleImpact: 10 });
  }

  // Fallback default action if no problems identified
  if (actionsList.length === 0) {
    actionsList.push({ name: 'BUILD_FACTORY', expectedProfit: 0.4, risk: 0.3, cashCost: 8000000, moraleImpact: 0 });
    actionsList.push({ name: 'INCREASE_MARKETING', expectedProfit: 0.3, risk: 0.1, cashCost: 1000000, moraleImpact: 0 });
  }

  // 3. Score actions using Company DNA weights
  let bestAction: HeuristicAction | null = null;
  let bestScore = -9999;

  for (const act of actionsList) {
    let score = act.expectedProfit * 100;
    
    // Adjust by risk tolerance
    score -= act.risk * 50 * (1 - dna.riskTolerance);
    
    // DNA alignment bonuses
    if (act.name === 'INCREASE_RD' || act.name === 'LAUNCH_PRODUCT') {
      score += dna.innovation * 30;
    }
    if (act.name === 'LAYOFFS') {
      score += dna.costEfficiency * 40;
      score -= dna.employeeCare * 30; // High employee care penalizes layoffs
    }
    if (act.name === 'INCREASE_MARKETING') {
      score += dna.marketingFocus * 30;
    }
    if (act.name === 'BUILD_FACTORY') {
      score += dna.expansionFocus * 30;
    }

    // Affordability check - cannot spend cash we don't have unless risk tolerance is extreme
    if (act.cashCost > company.cash && act.name !== 'TAKE_LOAN') {
      score -= (1 - dna.riskTolerance) * 1000; // Heavy penalty if risk averse
    }

    if (score > bestScore) {
      bestScore = score;
      bestAction = act;
    }
  }

  if (!bestAction) return null;

  // 4. Return selected Action package
  return {
    actionName: bestAction.name,
    parameters: {
      budget: Math.abs(bestAction.cashCost),
      actor: 'AI',
      timestamp: Date.now(),
    },
  };
}
