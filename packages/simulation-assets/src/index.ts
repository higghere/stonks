export interface NewspaperTemplate {
  source: "Bloomberg" | "Financial Times" | "Reuters" | "WSJ";
  headlines: string[];
}

export const NEWSPAPER_TEMPLATES: Record<string, NewspaperTemplate> = {
  PRODUCT_LAUNCH: {
    source: "Reuters",
    headlines: [
      "{company} launches '{product}' targeting the {segment} market segment.",
      "{company} expands product catalog with brand new '{product}'.",
      "Lumia reboot? {company} reveals new '{product}' with custom battery tech.",
    ],
  },
  ACQUISITION: {
    source: "Bloomberg",
    headlines: [
      "{company} consolidates market share after acquiring {target} in multi-billion deal.",
      "Consolidation wave: {company} announces successful acquisition of {target}.",
      "Bloomberg: {company} secures board approval to acquire competitor {target}.",
    ],
  },
  CEO_FIRED: {
    source: "Financial Times",
    headlines: [
      "Financial Times: {company} board votes to replace CEO following underperformance.",
      "Corporate shakeup: {company} appoints new CEO as board confidence hits lows.",
      "Market react: {company} shares jump after emergency CEO restructuring.",
    ],
  },
  MACRO_EVENT: {
    source: "WSJ",
    headlines: [
      "Wall Street Journal: {country} GDP projections revised upward amid trade expansion.",
      "Federal rate shift: {country} Central Bank cuts base interest rate to {rate}%.",
      "Supply chain shock: {resource} spot price surges {change}% globally.",
    ],
  },
};
export default NEWSPAPER_TEMPLATES;
