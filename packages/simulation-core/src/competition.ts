import { ProductState, CompanyReputation } from '@stock-market/simulation-common';

export interface ConsumerPreferences {
  priceWeight: number;      // Higher means consumers are price sensitive
  qualityWeight: number;    // Higher means consumers value tech features
  brandWeight: number;      // Higher means consumers prefer luxury/brand
}

/**
 * Calculates the competitiveness score of a single product based on product stats,
 * company reputation, and buyer group preferences.
 */
export function calculateProductCompetitiveness(
  product: ProductState,
  reputation: CompanyReputation,
  prefs: ConsumerPreferences
): number {
  if (product.lifecycle === 'OBSOLETE') return 0;

  // Base Quality (0-100) and Price (>0)
  const qualityScore = Math.max(1, product.quality) * prefs.qualityWeight;
  const priceAffordability = Math.max(0.1, 1000 / product.price) * prefs.priceWeight;
  
  // Brand/Reputation weight
  const brandScore = Math.max(1, reputation.reliability + reputation.innovation + reputation.luxury) * prefs.brandWeight;

  const score = (qualityScore + priceAffordability + brandScore) * (product.popularity / 100);
  
  // Age penalty - older products lose competitiveness
  const agePenalty = Math.max(0.1, 1 - (product.ageTicks / 1000));
  
  return score * agePenalty;
}

/**
 * Resolves the market share allocations for a list of products in a segment.
 */
export function resolveMarketShares(
  products: { product: ProductState; reputation: CompanyReputation }[],
  prefs: ConsumerPreferences
): Record<string, number> {
  const scores: Record<string, number> = {};
  let totalScore = 0;

  for (const item of products) {
    const score = calculateProductCompetitiveness(item.product, item.reputation, prefs);
    scores[item.product.id] = score;
    totalScore += score;
  }

  const shares: Record<string, number> = {};
  for (const item of products) {
    shares[item.product.id] = totalScore > 0 ? scores[item.product.id] / totalScore : 0;
  }

  return shares;
}
