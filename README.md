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
| 5 | Usage tracking and fallback end to end | done |
| 6 | Streaming | done |
| 7 | Dockerfile, Compose app service, final test run | done |

The available routes are `GET /health` and `POST /v1/chat/completions`, with `model` or ordered `models`
fallback, usage persistence, and SSE streaming via `"stream": true`.

## Stack

TypeScript, NestJS 11 on the default Express platform, PostgreSQL 16, Drizzle ORM, Jest, Docker Compose. Provider calls use the official `openai`, `@anthropic-ai/sdk`, and `@google/genai` SDKs with their built-in retries disabled, so the router's fallback loop is the only retry policy.

## Quick start with Docker Compose

Requires Docker. Provider keys are read from your shell or from a `.env` file next to `docker-compose.yml`.

```bash
cp .env.example .env            # fill in the provider keys you want to enable
docker compose up -d --build
docker compose exec app node dist/scripts/create-api-key.js --name "local dev"
```

The `app` container applies the migrations and then starts the server, so a failed migration keeps it from serving traffic. The key script prints the plaintext key once. Only its SHA-256 hash is stored.

The host port comes from `PORT` in your shell or `.env` and defaults to 3000. If something else already listens there, run `PORT=3210 docker compose up -d --build` and use that port in the commands below. The container itself always listens on 3000. Postgres is published on `POSTGRES_PORT`, default 5432, for local development; if that port is taken, set `POSTGRES_PORT` and update the port in `DATABASE_URL` to match. The timeout variables listed under Configuration are passed through to the container as well.

Send a request:

```bash
curl -s localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer lr_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-sonnet","messages":[{"role":"user","content":"Say hello"}]}'
```

Add `"stream": true` for an event stream, or send `"models": [...]` for fallback. See Public API below.

## Local development

Requires Node 22 or newer and Docker for Postgres.

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run migrate
npm run key:create -- --name "local dev"
npm run start:dev
```

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

Send `models` instead of `model` to request fallback. Exactly one of the two must be present.

```json
{
  "models": ["anthropic/claude-sonnet", "openai/gpt-5"],
  "messages": [{ "role": "user", "content": "Explain Kafka consumer groups" }]
}
```

Up to two entries are tried in order; a third is rejected with 400 "Maximum of 2 models allowed". The
response's `model` field names the alias that actually served. Fallback happens only on 429, 5xx, network
errors, timeouts, and unconfigured providers. Validation errors, authentication errors, and safety refusals
never fall back.

Every request that reaches the chat service writes one row to `usage`: status `success`,
`client_disconnect`, or `error:<code>`, with the alias that served or was last attempted. Requests rejected
by authentication or body validation write no row.

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
| `npm run test:e2e` | Integration tests against the full app with fake providers and mocked key and usage services. |
| `npm run test:db` | Key and usage persistence against the Compose Postgres. Needs `DATABASE_URL`; skipped without it. |
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
├── chat/                   controller, service (routing call, usage row, summary log), DTOs, formatting
└── usage/                  UsageService: one row per request, never throws
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

## Docker

`Dockerfile` is a two-stage build: compile with dev dependencies, then copy `dist/`, production `node_modules`, and `drizzle/` into a `node:22-alpine` image that runs as the `node` user. The container healthcheck polls `/health`. `docker-compose.yml` starts `app` and `postgres`; `app` waits for the Postgres healthcheck, runs the migrations, then starts.

Useful commands:

```bash
docker compose up -d --build          # build and start both services
docker compose logs -f app            # request summary lines, fallbacks, errors
docker compose exec app node dist/scripts/create-api-key.js --name ci
docker compose exec postgres psql -U myrouter -d myrouter -c 'select model, provider, status, latency_ms from usage order by created_at desc limit 5;'
docker compose down                   # add -v to drop the database volume
```

## Verification

Automated, no credentials needed:

```bash
npm run typecheck
npm test                              # unit
npm run test:e2e                      # full app, fake providers
DATABASE_URL=postgres://myrouter:myrouter@localhost:5432/myrouter npm run test:db
```

The e2e suite covers authentication, validation, routing to each provider, fallback and no-fallback rules, usage records, streaming frames, pre-commit and post-commit streaming failures, and client disconnect.

Against real providers, with keys in `.env` and the stack up via Compose:

```bash
KEY=$(docker compose exec app node dist/scripts/create-api-key.js --name manual | tail -1)
H=(-H "Authorization: Bearer $KEY" -H "Content-Type: application/json")
M='"messages":[{"role":"user","content":"Reply with one word."}]'

curl -s localhost:3000/v1/chat/completions "${H[@]}" -d "{\"model\":\"openai/gpt-5\",$M}"
curl -s localhost:3000/v1/chat/completions "${H[@]}" -d "{\"model\":\"anthropic/claude-sonnet\",$M}"
curl -s localhost:3000/v1/chat/completions "${H[@]}" -d "{\"model\":\"google/gemini-2.5-pro\",$M}"
curl -sN localhost:3000/v1/chat/completions "${H[@]}" -d "{\"model\":\"anthropic/claude-sonnet\",\"stream\":true,$M}"
curl -s localhost:3000/v1/chat/completions "${H[@]}" -d "{\"models\":[\"google/gemini-2.5-pro\",\"openai/gpt-5\"],$M}"
```

Expect an OpenAI-shaped completion from each of the first three with `usage` populated, a `text/event-stream` response ending in `data: [DONE]` from the fourth, and a completion whose `model` field names whichever alias served from the fifth. To see fallback, leave one provider's key unset and put it first in `models`. Each call adds a row to `usage`. Any OpenAI-compatible client pointed at `http://localhost:3000/v1` with the key as its API key works the same way.

## Principles

Kept from the spec: modular monolith, thin controllers, provider formats confined to adapters, explicit code over frameworks, dependency injection so providers can be mocked, and no billing, dashboards, queues, caches, or microservices in the MVP.
