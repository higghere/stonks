import { CompanyState, CountryState, FactoryState } from '@stock-market/simulation-common';

/**
 * Calculates updated balance sheet, revenues, expenses, and cash changes for a company.
 */
export function calculateCompanyFinancials(
  company: CompanyState,
  country: CountryState
): {
  cash: number;
  debt: number;
  assetsValue: number;
  liabilitiesValue: number;
  cashFlow: number;
  netIncome: number;
} {
  // 1. Calculate Revenue from Product Sales
  let revenue = 0;
  let costOfGoodsSold = 0;

  for (const prod of company.products) {
    const sales = prod.unitsSold;
    revenue += sales * prod.price;
    costOfGoodsSold += sales * prod.manufacturingCost;
  }

  // 2. Operations Expenses (Payroll, Factory Overheads)
  // Employee salary averages: Management ($150k), Engineers ($120k), Support ($50k), Sales ($70k), Manufacturing ($40k)
  const salaryCosts = 
    (company.employees.management * 150000 +
     company.employees.engineering * 120000 +
     company.employees.support * 50000 +
     company.employees.sales * 70000 +
     company.employees.manufacturing * 40000) / 365; // Daily salary cost

  // Factory overheads: $500/day per factory
  const factoryMaintenance = company.factories.length * 500;
  
  // R&D and Marketing expenses
  const rdCost = company.rdInvestment / 365;
  const marketingCost = (company.brandEquity * 100) / 365; // Proxy for marketing overhead

  const totalOperatingExpenses = costOfGoodsSold + salaryCosts + factoryMaintenance + rdCost + marketingCost;
  
  // 3. Operating Profit (EBITDA)
  const ebitda = revenue - totalOperatingExpenses;

  // Debt interest (e.g. 5% annual interest on outstanding debt)
  const interestCost = (company.debt * 0.05) / 365;
  
  const earningsBeforeTax = ebitda - interestCost;
  const taxRate = country.taxRate;
  const tax = earningsBeforeTax > 0 ? earningsBeforeTax * taxRate : 0;

  const netIncome = earningsBeforeTax - tax;

  // 4. Update Balance Sheet Values
  let cash = company.cash + netIncome;
  let debt = company.debt;

  // Servicing debt or paying dividends if netIncome is positive
  if (netIncome > 0 && company.dividendPayoutRatio > 0) {
    const dividendPayout = netIncome * company.dividendPayoutRatio;
    cash -= dividendPayout;
  }

  // Valuation of Assets: Cash + Book Value of Factories ($1M per factory base)
  const factoryBookValue = company.factories.reduce((acc: number, f: FactoryState) => acc + (1000000 * f.efficiency), 0);
  const assetsValue = Math.max(0, cash + factoryBookValue + company.inventory);
  const liabilitiesValue = debt;

  return {
    cash,
    debt,
    assetsValue,
    liabilitiesValue,
    cashFlow: ebitda,
    netIncome,
  };
}
