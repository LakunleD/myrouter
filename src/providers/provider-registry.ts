import type { LLMProvider } from './llm-provider.interface';
import type { ProviderName } from './unified.types';

/** Holds only the adapters whose credentials are configured. A missing entry means "unavailable". */
export class ProviderRegistry {
  private readonly providers = new Map<ProviderName, LLMProvider>();

  constructor(providers: LLMProvider[]) {
    for (const provider of providers) {
      this.providers.set(provider.name, provider);
    }
  }

  get(name: ProviderName): LLMProvider | undefined {
    return this.providers.get(name);
  }

  configured(): ProviderName[] {
    return [...this.providers.keys()];
  }
}
