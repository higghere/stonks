import { CountryState, EconomyState, ResourceNode } from '@stock-market/simulation-common';

/**
 * Calculates updated global commodity prices based on supply and demand shifts.
 */
export function calculateCommodityPrice(resource: ResourceNode): number {
  const demand = Math.max(1, resource.dailyConsumption);
  const supply = Math.max(1, resource.dailyProduction);
  
  // Price shift is proportional to scarcity/glut ratio
  const ratio = (demand - supply) / supply; // >0 is shortage, <0 is oversupply
  
  // Scarcity factor multiplies volatility
  const volatility = 0.5 * resource.scarcityFactor;
  let price = resource.price * (1 + ratio * volatility);

  return Math.max(0.1, parseFloat(price.toFixed(2)));
}

/**
 * Simulates country economic indicators for a tick.
 */
export function simulateCountryEconomy(country: CountryState, economy: EconomyState): CountryState {
  const updated = { ...country };

  // GDP growth depends on consumer confidence and low interest rates
  const rateEffect = (6 - country.interestRate) / 100; // Low rates boost GDP
  const confidenceEffect = (country.consumerConfidence - 70) / 300;
  
  const gdpGrowth = 0.02 + rateEffect + confidenceEffect; // e.g. 2% base + shifts
  updated.gdp = Math.max(1, updated.gdp * (1 + gdpGrowth / 365)); // Daily increment

  // Inflation rises with high GDP growth and oil price spikes
  const oilSurcharge = (economy.oilPrice - 75) / 500;
  const growthPressure = gdpGrowth * 0.3;
  
  updated.inflation = Math.max(-0.02, updated.inflation + (growthPressure + oilSurcharge) / 365);

  // Currency strength rises with strong GDP and high interest rates
  const currencyShift = (gdpGrowth + (country.interestRate / 100)) * 0.1;
  updated.currencyStrength = Math.max(0.2, updated.currencyStrength + currencyShift);

  return updated;
}
