import { CompanyState } from '@stock-market/simulation-common';

/**
 * Audit CEO performance. If board confidence falls below threshold, fires the CEO
 * and updates objectives, returning the event name.
 */
export function auditCEOPerformance(company: CompanyState): {
  fired: boolean;
  company: CompanyState;
  log?: string;
} {
  const updated = { ...company };

  // Board confidence diminishes if assets drop, liabilities spike, or cash flow is severely negative
  let confidenceDeduction = 0;
  if (company.cashFlow < 0) {
    confidenceDeduction += 5; // Low cash flow concerns board
  }
  if (company.cash < 500000) {
    confidenceDeduction += 15; // Liquidity crisis
  }
  if (company.marketShare < 0.08) {
    confidenceDeduction += 10; // Severe market share loss
  }

  // CEO approval recovers slightly if cash rises
  let approvalGain = 0;
  if (company.cashFlow > 2000000) {
    approvalGain += 2;
  }

  updated.boardConfidence = Math.max(0, Math.min(100, company.boardConfidence - confidenceDeduction + approvalGain));

  // If Board Confidence falls below 30%, replace the CEO!
  if (updated.boardConfidence < 30) {
    updated.boardConfidence = 80; // Reset board confidence for new CEO
    updated.ceoApproval = 90; // Reset approval rating
    
    // New CEO changes objectives slightly
    const oldMilestone = `CEO replaced due to poor performance. Board confidence was ${company.boardConfidence.toFixed(0)}%`;
    updated.memory.longTerm.push(oldMilestone);

    return {
      fired: true,
      company: updated,
      log: oldMilestone,
    };
  }

  return { fired: false, company: updated };
}
