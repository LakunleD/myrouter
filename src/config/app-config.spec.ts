import { loadConfig } from './app-config';

describe('loadConfig', () => {
  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow('DATABASE_URL');
  });

  it('applies defaults and reads optional values', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://x',
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: '  ',
    });
    expect(config.port).toBe(3000);
    expect(config.providerTimeoutMs).toBe(60_000);
    expect(config.openaiApiKey).toBe('sk-test');
    expect(config.anthropicApiKey).toBeUndefined();
  });

  it('rejects non-numeric integers', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', PORT: 'abc' })).toThrow('PORT');
  });
});
