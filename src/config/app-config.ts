export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  port: number;
  databaseUrl: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  /** Optional overrides for the upstream model behind each public alias. */
  openaiModelId?: string;
  anthropicModelId?: string;
  googleModelId?: string;
  /** Whole-attempt timeout for non-streaming provider calls. */
  providerTimeoutMs: number;
  /** Time allowed for a streaming attempt to deliver its first chunk. */
  streamFirstChunkTimeoutMs: number;
  /** Maximum silence between streamed chunks once the attempt is committed. */
  streamIdleTimeoutMs: number;
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = optional(env, name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = optional(env, 'DATABASE_URL');
  if (!databaseUrl) {
    throw new Error('Environment variable DATABASE_URL is required');
  }
  return {
    port: integer(env, 'PORT', 3000),
    databaseUrl,
    openaiApiKey: optional(env, 'OPENAI_API_KEY'),
    anthropicApiKey: optional(env, 'ANTHROPIC_API_KEY'),
    googleApiKey: optional(env, 'GOOGLE_API_KEY'),
    openaiModelId: optional(env, 'OPENAI_MODEL_ID'),
    anthropicModelId: optional(env, 'ANTHROPIC_MODEL_ID'),
    googleModelId: optional(env, 'GOOGLE_MODEL_ID'),
    providerTimeoutMs: integer(env, 'PROVIDER_TIMEOUT_MS', 60_000),
    streamFirstChunkTimeoutMs: integer(env, 'STREAM_FIRST_CHUNK_TIMEOUT_MS', 30_000),
    streamIdleTimeoutMs: integer(env, 'STREAM_IDLE_TIMEOUT_MS', 60_000),
  };
}
