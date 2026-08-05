import { CompanyState, EconomyState } from '@stock-market/simulation-common';

/**
 * Calculates stock price deterministically based on financials, sentiment, and macro indicators.
 */
export function calculateStockPrice(company: CompanyState, economy: EconomyState): number {
  if (company.lifecycle === 'BANKRUPT' || company.lifecycle === 'LIQUIDATED') {
    return 0.01; // Pennies
  }

  // 1. Fundamental Valuation (Book Value & Cash Flow)
  const bookValue = Math.max(0.1, company.assetsValue - company.liabilitiesValue);
  const earnings = Math.max(0.01, company.cashFlow); // Cash flow proxy for earnings

  // 2. Base P/E and P/B multiples
  let peMultiple = 15; // Baseline
  let pbMultiple = 1.5; // Baseline

  // 3. Impact of Technology/Innovation and Brand Equity
  const brandMultiplier = 1 + (company.brandEquity / 500); // Lifts multiples
  const techMultiplier = 1 + (company.technologyIndex / 300); // Lifts multiples

  peMultiple *= brandMultiplier * techMultiplier;
  pbMultiple *= brandMultiplier * techMultiplier;

  // 4. Market Psychology Adjustment
  // Greed index high -> expand PE multiple. Fear index high -> depress PE.
  const sentimentShift = (economy.fearGreedIndex - 50) / 100; // -0.5 to 0.5
  peMultiple *= (1 + sentimentShift * 0.4);
  pbMultiple *= (1 + sentimentShift * 0.3);

  // Market momentum and Panic factor
  peMultiple *= (1 + economy.marketMomentum * 0.2);
  if (economy.panicFactor > 0) {
    peMultiple *= (1 - economy.panicFactor * 0.6); // Massive contraction during panic
    pbMultiple *= (1 - economy.panicFactor * 0.4);
  }

  // 5. Valuation estimation
  const earningsValuation = earnings * peMultiple;
  const bookValuation = bookValue * pbMultiple;

  // Blend of Earnings and Book Value (70% earnings, 30% book value)
  let valuation = earningsValuation * 0.7 + bookValuation * 0.3;

  // 6. Ticker Outstanding Shares proxy (let's assume 10 million shares for calculation simplicity)
  const outstandingShares = 10000000;
  let price = valuation / outstandingShares;

  // Lifecycle multipliers
  if (company.lifecycle === 'STARTUP') price *= 1.2; // Growth premium
  if (company.lifecycle === 'GROWTH') price *= 1.5; // High growth premium
  if (company.lifecycle === 'DECLINING') price *= 0.4; // Distress penalty

  return Math.max(0.05, parseFloat(price.toFixed(2)));
}
