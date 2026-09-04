import { Module } from '@nestjs/common';
import { ProviderRegistry } from './provider-registry';

/**
 * Phase 3 stub: registers no adapters, so every provider is "unavailable".
 * Phase 4 builds the registry from the configured credentials.
 */
@Module({
  providers: [{ provide: ProviderRegistry, useFactory: () => new ProviderRegistry([]) }],
  exports: [ProviderRegistry],
})
export class ProvidersModule {}
