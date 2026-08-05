import { CompanyState } from '@stock-market/simulation-common';

/**
 * Updates memory logs, decaying short/medium term memories and moving major events to long term.
 */
export function updateCompanyMemory(company: CompanyState): CompanyState {
  const updated = { ...company };
  
  // 1. Decay Short-Term memory (limit to last 15 items)
  if (updated.memory.shortTerm.length > 15) {
    const popped = updated.memory.shortTerm.shift(); // Remove oldest
    
    // If it's a major event (e.g. contains 'Acquired', 'Crisis', 'Failed'), promote to medium-term
    if (popped && (popped.includes('Acquired') || popped.includes('Crisis') || popped.includes('Diverged') || popped.includes('Bankrupt'))) {
      updated.memory.mediumTerm.push(popped);
    }
  }

  // 2. Decay Medium-Term memory (limit to last 30 items)
  if (updated.memory.mediumTerm.length > 30) {
    const poppedMedium = updated.memory.mediumTerm.shift();
    
    // Major milestones (e.g. 'Nokia Survives', 'Acquired Ticker') are promoted to Long-Term
    if (poppedMedium && (poppedMedium.includes('Nokia') || poppedMedium.includes('CEO') || poppedMedium.includes('Acquired'))) {
      updated.memory.longTerm.push(poppedMedium);
    }
  }

  // 3. Keep Long-Term capped at 50 historical entries to avoid memory bloating
  if (updated.memory.longTerm.length > 50) {
    updated.memory.longTerm.shift();
  }

  return updated;
}
