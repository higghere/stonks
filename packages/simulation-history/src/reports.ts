import { CompanyState } from '@stock-market/simulation-common';

export interface AnnualReport {
  tickerId: string;
  year: number;
  revenue: number;
  cashBalance: number;
  debtBalance: number;
  employeeCount: number;
  factoryCount: number;
  productsList: { name: string; share: number; units: number }[];
  ceoLetter: string;
}

/**
 * Compiles a detailed corporate Annual Report from the simulation company state.
 */
export function generateAnnualReport(company: CompanyState, year: number): AnnualReport {
  let revenue = 0;
  const productsList: { name: string; share: number; units: number }[] = [];

  for (const prod of company.products) {
    const rev = prod.unitsSold * prod.price;
    revenue += rev;
    productsList.push({
      name: prod.name,
      share: 0,
      units: prod.unitsSold,
    });
  }

  // Calculate market shares within catalog
  for (const item of productsList) {
    item.share = revenue > 0 ? (item.units * company.products.find(p => p.name === item.name)!.price) / revenue : 0;
  }

  // Generate CEO Letter dynamically based on morale and financial health
  let letter = `Dear Shareholders,\n\n`;
  if (company.cashFlow > 0) {
    letter += `This fiscal year has been marked by strong execution and financial growth. Our net cash flow reached $${(company.cashFlow / 1000000).toFixed(2)}M, reflecting robust demand for our core product offerings. We continue to invest in R&D ($${(company.rdInvestment / 1000000).toFixed(2)}M) to protect our tech advantage.`;
  } else {
    letter += `This has been a challenging fiscal year as we navigate changing customer preferences and rising raw material costs. We have prioritized cost discipline and operational efficiency to steady our balance sheet. The board has approved strategic restructuring initiatives to return to growth next year.`;
  }

  letter += `\n\nWe are extremely grateful to our engineering and design teams for their dedication. Our brand reputation index remains strong at ${(company.reputation.innovation).toFixed(0)} points in innovation. Thank you for your continued partnership.\n\nSincerely,\nCEO of ${company.tickerId}`;

  return {
    tickerId: company.tickerId,
    year,
    revenue,
    cashBalance: company.cash,
    debtBalance: company.debt,
    employeeCount: Object.values(company.employees).reduce((acc, count) => acc + count, 0),
    factoryCount: company.factories.length,
    productsList,
    ceoLetter: letter,
  };
}
