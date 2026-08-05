import { SimulationWorld } from '@stock-market/simulation-common';

export interface TimelineMilestone {
  tick: number;
  year: number;
  event: string;
  description: string;
  divergenceScore: number;
  butterflyRadius: number; // Count of entities affected
}

/**
 * Computes how far the simulation has diverged from standard baseline conditions (real world parameters).
 */
export function calculateDivergenceScore(world: SimulationWorld): number {
  let score = 0;

  // 1. Compare company states. Real world base stock price vs current price
  // For each company, if price shifts more than 30%, increase divergence index
  for (const company of Object.values(world.companies)) {
    // Standard baseline price is assumed to be $100 for normalization
    const base = 100;
    const diff = Math.abs(company.stockPrice - base) / base;
    if (diff > 0.3) {
      score += diff * 10;
    }
  }

  // 2. Compare Country GDPs
  for (const country of Object.values(world.countries)) {
    const baseGdpGrowth = 0.02; // Standard real-world trend line growth
    const actualGdp = country.gdp;
    // Normalized comparison
    if (actualGdp > 1.2 || actualGdp < 0.8) {
      score += 5;
    }
  }

  // Cap at 100%
  return Math.min(100, parseFloat(score.toFixed(2)));
}

/**
 * Recursively maps the Butterfly Radius cascade path of a player action.
 */
export function traceButterflyRadius(
  actionEntityId: string,
  relationships: Record<string, string[]>
): string[] {
  const visited = new Set<string>();
  const queue: string[] = [actionEntityId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current && !visited.has(current)) {
      visited.add(current);
      
      // Get neighbors in B2B graph
      const neighbors = relationships[current] || [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          queue.push(next);
        }
      }
    }
  }

  return Array.from(visited);
}
