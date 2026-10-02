// Report wording per client type (Client.clientType). Trades quote on site
// and win jobs; everyone else gets the generic words. Pure — safe in the UI.

export type ClientTypeValue = "TRADE" | "SERVICE" | "OTHER";

export function terms(clientType: ClientTypeValue | null | undefined) {
  const trade = clientType === "TRADE";
  return {
    quote: trade ? "Onsite quote" : "Quote",
    quotes: trade ? "Onsite quotes" : "Quotes",
    sale: trade ? "Job won" : "Sale",
    sales: trade ? "Jobs won" : "Sales",
  };
}

export const CLIENT_TYPE_LABELS: Record<ClientTypeValue, string> = { TRADE: "Trade", SERVICE: "Service", OTHER: "Other" };
