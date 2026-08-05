import { MarketProvider } from '../providers/base.provider';
import { MockProvider } from '../providers/mock.provider';
import { YahooFinanceProvider } from '../providers/yahoo.provider';
import { ConfigService } from '@stock-market/config';
import { Logger } from '@stock-market/logger';

const config = ConfigService.getInstance();

export class ProviderManager {
  private static instance: ProviderManager;
  private providers: MarketProvider[] = [];

  private constructor() {
    const providerType = config.get('MARKET_PROVIDER');
    if (providerType === 'mock') {
      this.providers = [new MockProvider()];
    } else {
      this.providers = [new YahooFinanceProvider(), new MockProvider()];
    }
  }

  public static getInstance(): ProviderManager {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager();
    }
    return ProviderManager.instance;
  }

  public getActiveProviders(): MarketProvider[] {
    return this.providers;
  }

  public async search(query: string): Promise<Array<{ ticker: string; name: string; exchange: string; assetType: string }>> {
    for (const provider of this.providers) {
      try {
        Logger.info(`[PROVIDER MANAGER] Searching query "${query}" on provider: ${provider.getName()}`);
        const results = await provider.searchTickers(query);
        if (results && results.length > 0) {
          return results;
        }
      } catch (err) {
        Logger.error(`[PROVIDER MANAGER] Search failed on provider: ${provider.getName()}`, err);
      }
    }
    return [];
  }
}
export default ProviderManager;
