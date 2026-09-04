import type { ProviderName } from '../providers/unified.types';

export interface ModelEntry {
  provider: ProviderName;
  upstreamModel: string;
}

export type ModelRegistry = Readonly<Record<string, ModelEntry>>;

/** Upstream ids behind each alias. Overridable per provider through env; confirm against provider docs. */
export const DEFAULT_UPSTREAM_MODELS: Readonly<Record<ProviderName, string>> = {
  openai: 'gpt-5',
  anthropic: 'claude-sonnet-5',
  google: 'gemini-2.5-pro',
};

/**
 * The single source of truth for alias → provider + upstream model.
 * Public aliases are deliberately specific so a future upstream change is a data edit here.
 */
export function buildModelRegistry(overrides: Partial<Record<ProviderName, string>> = {}): ModelRegistry {
  const upstream = (name: ProviderName): string => overrides[name] ?? DEFAULT_UPSTREAM_MODELS[name];
  return {
    'openai/gpt-5': { provider: 'openai', upstreamModel: upstream('openai') },
    'anthropic/claude-sonnet': { provider: 'anthropic', upstreamModel: upstream('anthropic') },
    'google/gemini-2.5-pro': { provider: 'google', upstreamModel: upstream('google') },
  };
}
