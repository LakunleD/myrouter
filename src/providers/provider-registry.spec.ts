import { FakeProvider } from '../../test/fake-provider';
import { ProviderRegistry } from './provider-registry';

describe('ProviderRegistry', () => {
  it('returns configured adapters by name and undefined otherwise', () => {
    const openai = new FakeProvider('openai', []);
    const registry = new ProviderRegistry([openai]);
    expect(registry.get('openai')).toBe(openai);
    expect(registry.get('anthropic')).toBeUndefined();
    expect(registry.configured()).toEqual(['openai']);
  });
});
