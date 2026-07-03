import { Logger } from '@stock-market/logger';

export class QuoteInterestService {
  private static instance: QuoteInterestService | null = null;

  // Map of symbol -> Set of connectionIds interested in this symbol
  private interests = new Map<string, Set<string>>();

  // Reverse mapping: connectionId -> Set of symbols they are interested in (for fast cleanup)
  private connectionSymbols = new Map<string, Set<string>>();

  private constructor() {}

  public static getInstance(): QuoteInterestService {
    if (!this.instance) {
      this.instance = new QuoteInterestService();
    }
    return this.instance;
  }

  /**
   * Registers interest for a connection on a list of symbols
   */
  public registerInterest(connectionId: string, symbols: string[]): void {
    if (symbols.length === 0) return;

    Logger.info(`[INTEREST] Connection ${connectionId} registering interest for: ${symbols.join(', ')}`);

    // Get or create connection symbol set
    let connSet = this.connectionSymbols.get(connectionId);
    if (!connSet) {
      connSet = new Set<string>();
      this.connectionSymbols.set(connectionId, connSet);
    }

    for (const rawSym of symbols) {
      const sym = rawSym.toUpperCase().trim();
      if (!sym) continue;

      // Add to symbol -> connections mapping
      let connIds = this.interests.get(sym);
      if (!connIds) {
        connIds = new Set<string>();
        this.interests.set(sym, connIds);
      }
      connIds.add(connectionId);

      // Add to connection -> symbols mapping
      connSet.add(sym);
    }
  }

  /**
   * Unregisters interest for a connection on a list of symbols
   */
  public unregisterInterest(connectionId: string, symbols: string[]): void {
    if (symbols.length === 0) return;

    Logger.info(`[INTEREST] Connection ${connectionId} leaving interest for: ${symbols.join(', ')}`);

    const connSet = this.connectionSymbols.get(connectionId);

    for (const rawSym of symbols) {
      const sym = rawSym.toUpperCase().trim();
      if (!sym) continue;

      // Remove from symbol -> connections mapping
      const connIds = this.interests.get(sym);
      if (connIds) {
        connIds.delete(connectionId);
        if (connIds.size === 0) {
          this.interests.delete(sym);
        }
      }

      // Remove from connection -> symbols mapping
      if (connSet) {
        connSet.delete(sym);
      }
    }

    if (connSet && connSet.size === 0) {
      this.connectionSymbols.delete(connectionId);
    }
  }

  /**
   * Cleans up all interests associated with a connection when it disconnects
   */
  public clearConnection(connectionId: string): void {
    const connSet = this.connectionSymbols.get(connectionId);
    if (!connSet) return;

    Logger.info(`[INTEREST] Connection ${connectionId} disconnected. Clearing all interest subscriptions.`);

    // Unsubscribe from all symbols
    const symbolsArray = Array.from(connSet);
    this.unregisterInterest(connectionId, symbolsArray);
  }

  /**
   * Returns a list of all symbols that have active client interest
   */
  public getActiveSymbols(): string[] {
    return Array.from(this.interests.keys());
  }

  /**
   * Checks if a symbol currently has active client interest
   */
  public hasInterest(symbol: string): boolean {
    const connIds = this.interests.get(symbol.toUpperCase().trim());
    return connIds ? connIds.size > 0 : false;
  }
}
