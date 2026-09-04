# myrouter

An OpenRouter-style LLM gateway. One OpenAI-compatible endpoint, `POST /v1/chat/completions`, routes chat requests to OpenAI, Anthropic, or Google Gemini based on the requested model, with API key authentication, two-attempt fallback, SSE streaming, and per-request usage tracking in PostgreSQL.

Design and build order live in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). The original brief is [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md).

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Scaffold: config, errors, request IDs, health endpoint | done |
| 2 | Database schema, migrations, API key auth, key script | done |
| 3 | Model registry, provider registry, routing, fallback | done |
| 4 | Provider adapters and the chat endpoint (non-streaming) | done |
| 5 | Usage tracking and fallback end to end | pending |
| 6 | Streaming | pending |
| 7 | Dockerfile, Compose app service, final test run | pending |

The available routes are `GET /health` and non-streaming `POST /v1/chat/completions`. Usage persistence,
fallback request bodies, and SSE streaming land in phases 5 and 6.

## Stack

TypeScript, NestJS 11 on the default Express platform, PostgreSQL 16, Drizzle ORM, Jest, Docker Compose. Provider calls use the official `openai`, `@anthropic-ai/sdk`, and `@google/genai` SDKs with their built-in retries disabled, so the router's fallback loop is the only retry policy.

## Quick start

Requires Node 22 or newer and Docker.

```bash
npm install
cp .env.example .env            # fill in provider keys when you reach phase 4
docker compose up -d postgres
npm run migrate
npm run key:create -- --name "local dev"
npm run start:dev
```

The key script prints the plaintext key once. Only its SHA-256 hash is stored.

Check it is up:

```bash
curl -i localhost:3000/health
```

Expect `200`, `{"status":"ok"}`, and an `x-request-id` header.

## Configuration

All configuration is environment variables. See [.env.example](.env.example).

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. The app refuses to start without it. |
| `PORT` | no | HTTP port, default 3000. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` | no | A provider with no key is treated as unavailable, which lets a fallback list skip past it. |
| `OPENAI_MODEL_ID`, `ANTHROPIC_MODEL_ID`, `GOOGLE_MODEL_ID` | no | Override the upstream model behind each public alias. |
| `PROVIDER_TIMEOUT_MS` | no | Whole-attempt timeout for non-streaming calls, default 60000. |
| `STREAM_FIRST_CHUNK_TIMEOUT_MS` | no | Time allowed for a streaming attempt to send its first chunk, default 30000. |
| `STREAM_IDLE_TIMEOUT_MS` | no | Maximum silence between streamed chunks, default 60000. |

Never commit `.env` or provider credentials. `.gitignore` already excludes `.env`.

## Public API

```http
POST /v1/chat/completions
Authorization: Bearer lr_...
Content-Type: application/json
```

```json
{
  "model": "anthropic/claude-sonnet",
  "messages": [{ "role": "user", "content": "Explain Kafka consumer groups" }],
  "stream": false
}
```

Public model aliases resolve through the in-code registry to a provider and an upstream model ID:

| Alias | Provider |
|---|---|
| `openai/gpt-5` | OpenAI |
| `anthropic/claude-sonnet` | Anthropic |
| `google/gemini-2.5-pro` | Google |

Phase 4 accepts one `model`. The routing layer already supports two ordered attempts; the public `models`
fallback request shape lands in phase 5. Fallback happens only on 429, 5xx, network errors, timeouts, and
unconfigured providers. Validation errors, authentication errors, and safety refusals never fall back.

Every error, from any layer, has one shape:

```json
{
  "error": {
    "message": "Upstream provider temporarily unavailable",
    "type": "provider_unavailable",
    "code": "provider_unavailable",
    "request_id": "lr_req_..."
  }
}
```

| Code | HTTP |
|---|---|
| `invalid_request` | 400 |
| `invalid_api_key` | 401 |
| `model_not_found` | 404 |
| `provider_rate_limited` | 429 |
| `provider_unavailable` | 502 |
| `provider_timeout` | 504 |
| `internal_error` | 500 |

## Scripts

| Command | What it does |
|---|---|
| `npm run start:dev` | Run from source with ts-node. It emits the decorator metadata Nest needs for injection; esbuild-based runners such as tsx do not. |
| `npm run build` then `npm start` | Compile to `dist/` and run. |
| `npm run typecheck` | Type-check without emitting. |
| `npm test` | Unit tests (`src/**/*.spec.ts`). |
| `npm run test:e2e` | Integration tests against the full app with mocked providers (from phase 4). |
| `npm run test:db` | Tests against the Compose Postgres (from phase 5). |
| `npm run migrate` | Apply migrations in `drizzle/`. |
| `npm run db:generate` | Generate a new migration after editing `src/database/schema.ts`. |
| `npm run key:create -- --name <name>` | Create an API key and print it once. |

## Project layout

```text
src/
├── main.ts                 bootstrap: body parser, validation pipe, exception filter
├── app.module.ts           module wiring and request-ID middleware
├── health.controller.ts    GET /health
├── config/                 typed env loader (APP_CONFIG)
├── common/
│   ├── errors/             ErrorCode table, RouterError, ClientDisconnected
│   ├── filters/            global filter: any throwable -> normalized error body
│   └── router-request.ts   Express Request plus requestId and apiKey
├── telemetry/              request-ID generator and middleware
├── database/               Drizzle schema, DatabaseModule, migration runner
├── auth/                   ApiKeyService, ApiKeyGuard
├── models/                 (phase 3) alias registry
├── providers/              LLMProvider contract, three adapters, ProviderRegistry
├── routing/                RoutingService, FallbackService
├── chat/                   non-streaming controller, service, DTOs, response formatting
└── usage/                  (phase 5) UsageService
scripts/create-api-key.ts
drizzle/                    committed SQL migrations
docs/                       project spec and implementation plan
test/                       e2e and db suites
```

Dependencies point one way: chat depends on routing and usage, routing on models and providers, auth and usage on database. Nothing imports chat.

## Database

Two tables, created by `drizzle/0000_init.sql`.

- `api_keys`: `id`, `name`, `key_hash` (unique, SHA-256 hex), `created_at`, `revoked_at`. Revoke a key by setting `revoked_at`.
- `usage`: one row per chat request with `request_id` (unique), `api_key_id`, `model`, `provider`, token counts, `latency_ms`, `status`, `created_at`. Indexed on `(api_key_id, created_at)`.

Prompts and completions are never stored or logged.

## Verifying the current build

```bash
npm run typecheck && npm test
docker compose up -d postgres
export DATABASE_URL=postgres://myrouter:myrouter@localhost:5432/myrouter
npm run migrate
npm run key:create -- --name check
docker compose exec postgres psql -U myrouter -d myrouter -c 'select name, length(key_hash) from api_keys;'
npm run start:dev &
curl -i localhost:3000/health
curl -s localhost:3000/does-not-exist
```

Expect: no type errors, all unit tests green, "Migrations applied", a key row with a 64-character hash, a 200 from `/health` with an `x-request-id` header, and a normalized `invalid_request` body from the unknown route.

## Principles

Kept from the spec: modular monolith, thin controllers, provider formats confined to adapters, explicit code over frameworks, dependency injection so providers can be mocked, and no billing, dashboards, queues, caches, or microservices in the MVP.
