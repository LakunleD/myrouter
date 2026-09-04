import type { AppConfig } from '../config/app-config';
import { buildModelRegistry } from './model-registry';
import { ModelRegistryService } from './model-registry.service';

const baseConfig = { databaseUrl: 'x' } as AppConfig;

describe('buildModelRegistry', () => {
  it('maps each alias to its provider with default upstream ids', () => {
    const registry = buildModelRegistry();
    expect(registry['openai/gpt-5']).toEqual({ provider: 'openai', upstreamModel: 'gpt-5' });
    expect(registry['anthropic/claude-sonnet']).toEqual({ provider: 'anthropic', upstreamModel: 'claude-sonnet-5' });
    expect(registry['google/gemini-2.5-pro']).toEqual({ provider: 'google', upstreamModel: 'gemini-2.5-pro' });
  });

  it('applies per-provider overrides without changing aliases', () => {
    const registry = buildModelRegistry({ anthropic: 'claude-opus-5' });
    expect(registry['anthropic/claude-sonnet'].upstreamModel).toBe('claude-opus-5');
    expect(registry['openai/gpt-5'].upstreamModel).toBe('gpt-5');
  });
});

describe('ModelRegistryService', () => {
  it('resolves known aliases and returns undefined for unknown ones', () => {
    const service = new ModelRegistryService(baseConfig);
    expect(service.resolve('google/gemini-2.5-pro')?.provider).toBe('google');
    expect(service.resolve('google/gemini')).toBeUndefined();
    expect(service.aliases()).toHaveLength(3);
  });

  it('reads overrides from config', () => {
    const service = new ModelRegistryService({ ...baseConfig, googleModelId: 'gemini-3-pro' });
    expect(service.resolve('google/gemini-2.5-pro')?.upstreamModel).toBe('gemini-3-pro');
  });
});
