# Implementation Plan: LLM Router MVP

Source: `PROJECT_SPEC.md` (revision of 2026-09-03 18:15). Repository state at planning time: empty apart from the spec. No existing code, config, or conventions to honor, so every choice below is fresh and follows the spec's principle of explicit, simple code.

Amendments accepted on 2026-09-03 before implementation, from two review rounds:

- No OpenTelemetry. No custom logger; Nest's built-in `Logger` only.
- `ModelRegistry` is the single source of truth for model-to-provider resolution. `supports()` is removed from `LLMProvider`. A `ProviderRegistry` maps provider name to adapter.
- `RoutingService.execute()` owns model resolution, provider selection, and fallback. `ChatService` stays thin: call routing, record usage, format.
- `ChatService` owns all usage recording (success, failure, disconnect). The exception filter only normalizes.
- More than two entries in `models` is a 400, not a silent truncation.
- A provider with no configured credentials is `PROVIDER_UNAVAILABLE` (retryable), so fallback proceeds past it.
- No repository abstractions created only for tests. Seven implementation phases.
- Public aliases are specific: `openai/gpt-5`, `anthropic/claude-sonnet`, `google/gemini-2.5-pro`.
- Streaming design and fallback semantics are unchanged.

## 0. Decisions and assumptions

| Topic | Decision | Why |
|---|---|---|
| HTTP platform | `@nestjs/platform-express` (Nest default) | Spec revision removed the Fastify adapter. |
| Logger | Nest's built-in `Logger`, unmodified, one instance per service. Structured fields are passed as an object in the log call. | Spec says use the default logger. |
| Model resolution | `ModelRegistry` maps every public alias to `{ provider, upstreamModel }`. `ProviderRegistry` maps provider name to the adapter instance. Adapters know nothing about aliases or prefixes. | One source of truth. |
| Orchestration | `RoutingService.execute()` / `executeStream()` own resolution, provider selection, per-attempt timeouts, and the fallback loop. `ChatService` calls routing, records usage, formats the response. | Keeps controller and service thin; routing policy has one home when smarter routing arrives later. |
| Unconfigured provider | `ProviderRegistry` holds only adapters whose credentials are present. Routing treats a missing adapter as `PROVIDER_UNAVAILABLE` (retryable) at attempt time, so a fallback list skips past it and a single-model request returns 502 `provider_unavailable`. | Fallback exists for exactly this case. |
| Fallback list length | `models` must have 1 or 2 entries. 3 or more is 400 `invalid_request` ("Maximum of 2 models allowed"). | Explicit beats silently modifying the request. |
| Usage ownership | `ChatService` writes exactly one usage row per chat request: success, error, or client disconnect. The exception filter never touches usage. | `usage.request_id` is unique; one writer avoids double inserts. Requests rejected before `ChatService` (401, 400) produce no row. |
| Test doubles | Nest `overrideProvider` on real providers (`ProviderRegistry`, `ApiKeyService`, `UsageService`) with Jest mocks. No repository layer. | No abstractions that exist only for tests. Database behaviour is covered by a separate suite against the Compose Postgres. |
| Provider SDKs | Official `openai`, `@anthropic-ai/sdk`, `@google/genai`, each constructed with `maxRetries: 0` | Typed errors and streaming helpers. SDK retries are off so the router's fallback loop is the only retry policy and "two attempts" stays true. |
| Request validation | `class-validator` + `class-transformer` via Nest `ValidationPipe` with `whitelist: true` | OpenAI clients send extra fields; stripping keeps compatibility. `tools`, `functions`, `response_format`, `n > 1` are rejected explicitly. |
| Message content | `content` must be a string | Multimodal parts are out of scope. |
| API key hashing | SHA-256 hex of the full key, unique index | Keys are 32 random bytes; a slow hash adds latency without adding safety. |
| Key format | `lr_` + 32 bytes base64url | Matches `lr_<random-secret>`. |
| Request ID | `lr_req_` + 16 bytes base64url, set in Express middleware | Exists before guards, pipes, and filters run. |
| Streaming transport | Raw `res.write` SSE frames, not Nest's `@Sse()` | `@Sse()` JSON-serializes every payload and cannot emit the literal `data: [DONE]`. |
| Streaming fallback | Allowed only before the first content chunk has been received from upstream; `RoutingService.executeStream()` awaits the first chunk inside the fallback loop and returns a committed stream. | Once bytes are on the wire the response cannot be replaced. |
| Anthropic `max_tokens` | Default 4096 when omitted | Anthropic requires the field. |
| Upstream model IDs | Defaults `gpt-5`, `claude-sonnet-5`, `gemini-2.5-pro`, each overridable via `OPENAI_MODEL_ID`, `ANTHROPIC_MODEL_ID`, `GOOGLE_MODEL_ID`. | Aliases hide upstream churn. OpenAI and Gemini defaults still need confirming against current provider docs. |
| Per-attempt timeout | 60 s non-streaming. Streaming: 30 s to first chunk, 60 s idle between chunks | Timeouts are a fallback trigger and need a definite value. |
| Usage on failure | One row, status `error:<code>`, token columns null, model = last attempted alias | Latency and error reporting need the failed rows too. |
| Runtime | npm, Node 22+ | Least ceremony. |

## 1. Modules

One NestJS application under `src/`. Dependencies point strictly downward.

```text
ChatModule -> RoutingModule -> ModelsModule
                            -> ProvidersModule
ChatModule -> UsageModule   -> DatabaseModule
AuthModule                  -> DatabaseModule
```

| Module | Responsibility | Exports |
|---|---|---|
| `AppModule` | Wires everything, applies the request-ID middleware, registers the global filter and validation pipe. | none |
| `ConfigModule` | Validated env loader. Fails fast on a missing `DATABASE_URL`; provider keys optional. | `APP_CONFIG` |
| `ChatModule` | `POST /v1/chat/completions`. Validates, calls routing, writes JSON or SSE, records usage. | none |
| `AuthModule` | `ApiKeyGuard`, key generation, hashing, lookup. Shared with the key script. | `ApiKeyService` |
| `ProvidersModule` | `LLMProvider` contract, three adapters, `ProviderRegistry` built from the configured credentials. | `ProviderRegistry` |
| `RoutingModule` | `RoutingService` (resolve, select, execute with fallback) and `FallbackService` (the retry rule). | `RoutingService` |
| `ModelsModule` | In-code alias registry. | `ModelRegistryService` |
| `UsageModule` | One usage row per request, never throws into the response path. | `UsageService` |
| `DatabaseModule` | Drizzle over `pg.Pool`, schema, migrations. | `DRIZZLE` |
| `TelemetryModule` | Request-ID middleware. | `RequestIdMiddleware` |

## 2. Files

```text
.
├── package.json · tsconfig.json · tsconfig.build.json · jest.config.ts · drizzle.config.ts
├── .env.example · .gitignore · .dockerignore · Dockerfile · docker-compose.yml · README.md
├── scripts/create-api-key.ts          # npm run key:create -- --name "local dev"
├── drizzle/                           # generated SQL migrations (committed)
├── src/
│   ├── main.ts                        # bootstrap, global pipe + filter, shutdown hooks
│   ├── app.module.ts
│   ├── health.controller.ts           # GET /health
│   ├── config/        app-config.ts · config.module.ts
│   ├── common/
│   │   ├── errors/    error-code.ts · router-error.ts · client-disconnected.ts
│   │   ├── filters/   router-exception.filter.ts
│   │   └── router-request.ts          # Express Request + requestId + apiKey
│   ├── chat/
│   │   ├── chat.controller.ts         # guard, DTO, delegate
│   │   ├── chat.service.ts            # routing call, usage row, formatting, SSE loop
│   │   ├── dto/       chat-completion-request.dto.ts · message.dto.ts
│   │   ├── openai-format.ts           # unified → completion / chunk objects
│   │   └── sse-writer.ts              # framing, backpressure, [DONE]
│   ├── auth/          auth.module.ts · api-key.guard.ts · api-key.service.ts
│   ├── providers/
│   │   ├── providers.module.ts        # builds ProviderRegistry from configured keys
│   │   ├── llm-provider.interface.ts · unified.types.ts · provider-registry.ts
│   │   ├── provider-error.ts          # shared status → RouterError mapping
│   │   ├── openai/    openai.provider.ts · openai.mapper.ts
│   │   ├── anthropic/ anthropic.provider.ts · anthropic.mapper.ts
│   │   └── google/    google.provider.ts · google.mapper.ts
│   ├── routing/       routing.module.ts · routing.service.ts · fallback.service.ts · attempt-signal.ts
│   ├── models/        models.module.ts · model-registry.ts · model-registry.service.ts
│   ├── usage/         usage.module.ts · usage.service.ts
│   ├── database/      database.module.ts · schema.ts · migrate.ts
│   └── telemetry/     telemetry.module.ts · request-id.ts · request-id.middleware.ts
└── test/
    ├── jest-e2e.config.ts · jest-db.config.ts
    ├── fake-provider.ts               # scripted LLMProvider
    ├── chat-completions.e2e-spec.ts   # ProviderRegistry, ApiKeyService, UsageService overridden via DI
    └── database.db-spec.ts            # real Postgres: migrations, key creation, usage row
```

Unit specs sit next to the file they test as `*.spec.ts`.

## 3. Interfaces

### Provider contract (`providers/`)

```ts
type ProviderName = 'openai' | 'anthropic' | 'google';

interface LLMProvider {
  readonly name: ProviderName;
  chat(req: UnifiedChatRequest): Promise<UnifiedChatResponse>;
  stream(req: UnifiedChatRequest): AsyncIterable<UnifiedStreamChunk>;
}

class ProviderRegistry {
  get(name: ProviderName): LLMProvider | undefined;   // undefined = not configured
  configured(): ProviderName[];
}

interface UnifiedMessage { role: 'system' | 'user' | 'assistant'; content: string }

interface UnifiedChatRequest {
  requestId: string;
  model: string;                 // upstream model id
  messages: UnifiedMessage[];
  maxTokens?: number; temperature?: number; topP?: number; stop?: string[];
  signal: AbortSignal;           // per-attempt timeout + client disconnect
}

type FinishReason = 'stop' | 'length' | 'content_filter';
interface UnifiedUsage { promptTokens: number; completionTokens: number; totalTokens: number }
interface UnifiedChatResponse { content: string; finishReason: FinishReason; usage: UnifiedUsage | null }
type UnifiedStreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'finish'; finishReason: FinishReason; usage: UnifiedUsage | null };
```

Safety refusals are successful responses with `content_filter`, so they never trigger fallback.

### Errors (`common/errors/`)

`ErrorCode` with HTTP status and retryable flag:

| Code | HTTP | Retryable | Upstream conditions |
|---|---|---|---|
| `invalid_request` | 400 | no | body validation; upstream 400 / 422 with sanitised message |
| `invalid_api_key` | 401 | no | missing, malformed, unknown, revoked key |
| `model_not_found` | 404 | no | alias not in registry; upstream 404 |
| `provider_rate_limited` | 429 | yes | upstream 429 |
| `provider_unavailable` | 502 | yes | upstream 500 / 502 / 503 / 504 / 529; connection errors; provider not configured |
| `provider_timeout` | 504 | yes | attempt timeout |
| `internal_error` | 500 | no | upstream 401 / 403 (our credentials, logged not exposed); anything unmapped |

`RouterError { code, httpStatus, retryable, provider?, model?, upstreamStatus?, cause? }`. `ClientDisconnected` is a separate sentinel error thrown when the client's socket closes mid-attempt; it is not a `RouterError` and never reaches the wire.

Wire format from `RouterExceptionFilter`, for every throwable:

```json
{ "error": { "message": "...", "type": "provider_unavailable", "code": "provider_unavailable", "request_id": "lr_req_..." } }
```

### Request DTO (`chat/dto/`)

Exactly one of `model: string` or `models: string[]` (1 to 2 entries; more is 400). `messages` non-empty with string content. `stream` default false. Optional `max_tokens`, `temperature`, `top_p`, `stop`. Unknown fields stripped. `tools`, `functions`, `response_format`, `n` other than 1 are 400.

### Routing (`routing/`)

```ts
interface RoutingRequest {
  requestId: string; models: string[]; messages: UnifiedMessage[];
  maxTokens?: number; temperature?: number; topP?: number; stop?: string[];
  clientSignal: AbortSignal;   // aborted when the HTTP client disconnects
}
interface Attempt { publicModel: string; provider: ProviderName; upstreamModel: string }
interface RoutingResult       { publicModel; provider; attempts: number; response: UnifiedChatResponse }
interface RoutingStreamResult { publicModel; provider; attempts: number; chunks: AsyncIterable<UnifiedStreamChunk> }

RoutingService.plan(models): Attempt[]                       // MODEL_NOT_FOUND fails fast
RoutingService.execute(req): Promise<RoutingResult>
RoutingService.executeStream(req): Promise<RoutingStreamResult>  // first chunk already received
FallbackService.run(requestId, plan, fn): Promise<{ value, attempt, attempts }>
```

`FallbackService.run` retries only when the thrown error is a `RouterError` with `retryable: true` and an attempt remains, logging request_id, from-model, to-model, and code. `RoutingService` wraps each attempt: looks up the adapter (missing adapter is `PROVIDER_UNAVAILABLE`), builds the attempt signal from the client signal plus a timeout, calls the adapter, and stamps `provider` and `model` on any `RouterError` so the usage row can name the last attempt.

### Auth and usage

`ApiKeyService.create(name) -> { id, key }`, `ApiKeyService.hash(key)`, `ApiKeyService.findActive(key) -> { id, name } | null`. `ApiKeyGuard` rejects with `INVALID_API_KEY` and attaches `{ id, name }` to the request.

`UsageService.record({ requestId, apiKeyId, model, provider, promptTokens, completionTokens, totalTokens, latencyMs, status })` never throws; status is `success`, `client_disconnect`, or `error:<code>`.

## 4. Database schema (Drizzle, PostgreSQL)

```text
api_keys
  id          uuid primary key default gen_random_uuid()
  name        text not null
  key_hash    text not null unique
  created_at  timestamptz not null default now()
  revoked_at  timestamptz null

usage
  id                 uuid primary key default gen_random_uuid()
  request_id         text not null unique
  api_key_id         uuid not null references api_keys(id)
  model              text not null        -- public alias served or last attempted
  provider           text null            -- null if no provider was reached
  prompt_tokens      integer null
  completion_tokens  integer null
  total_tokens       integer null
  latency_ms         integer not null
  status             text not null
  created_at         timestamptz not null default now()

index usage(api_key_id, created_at)
```

Migrations are generated with `drizzle-kit generate` and committed under `drizzle/`. The Docker entrypoint runs them before starting the server.

## 5. Request flow

Non-streaming:

1. **Request-ID middleware** generates `lr_req_...`, stores it on the request, sets `x-request-id`.
2. **ApiKeyGuard** hashes the bearer token and looks up an active key. Failure is 401.
3. **ValidationPipe** validates and strips the body. Failure is 400.
4. **ChatController** calls `chatService.complete(dto, req, res)`.
5. **ChatService** converts the DTO to a `RoutingRequest`, starts the latency clock, and calls `routingService.execute()`.
6. **RoutingService** resolves every alias through `ModelRegistry` (unknown alias is 404 before any provider call), then runs `FallbackService`. Each attempt looks up the adapter in `ProviderRegistry`, applies the timeout signal, and calls `chat()`. A retryable error with a second model left triggers attempt 2.
7. **ChatService** maps the result to an OpenAI `chat.completion` (`id` = request ID, `model` = alias that served), then records usage in its own try/catch, then returns. On error it records usage with the error status and the last attempted model, then rethrows.
8. **RouterExceptionFilter** renders the normalized body and status. It records nothing.

Streaming, from step 5:

5. `ChatService` calls `routingService.executeStream()`. Nothing has been written to the client yet.
6. Inside the fallback loop, each attempt starts `provider.stream()` and awaits the first chunk under the first-chunk timeout. A retryable failure before it falls back. When the first chunk arrives the attempt is committed and routing returns an iterable that yields that chunk first, then the rest under the idle timeout.
7. `SseWriter` sets the event-stream headers, flushes, then writes a role chunk, one `chat.completion.chunk` per delta, a finish chunk with usage, and `data: [DONE]`. Writes await `drain` on backpressure.
8. A `close` on the request aborts the client signal, which aborts the upstream call. `ChatService` records `client_disconnect` with tokens seen so far.
9. A failure after commit writes one SSE error frame in the normalized shape and ends the response. Usage is recorded with the error status.

Adapter responsibilities (the only place provider formats appear):

- **OpenAI**: near pass-through. Streams set `stream_options.include_usage`.
- **Anthropic**: system messages move to `system`; `max_tokens` defaults to 4096. Streams read input tokens from `message_start`, output tokens and `stop_reason` from `message_delta`. `end_turn → stop`, `max_tokens → length`, `refusal → content_filter`.
- **Google**: system messages become `systemInstruction`; assistant becomes role `model`. Usage from `usageMetadata`. `SAFETY` and prompt block reasons map to `content_filter`.

One summary log line per request: request_id, model, provider, status, latency_ms, attempts, prompt_tokens, completion_tokens. Message bodies are never logged.

## 6. Test strategy

Unit (Jest, no network, no database):

| Area | Cases |
|---|---|
| `ModelRegistryService` | the three aliases resolve; env overrides replace upstream IDs; unknown alias is undefined. |
| `RoutingService` | `plan()` resolves aliases and fails fast on an unknown one; unconfigured provider yields `PROVIDER_UNAVAILABLE` and falls back; single unconfigured model returns 502; timeouts map to `PROVIDER_TIMEOUT`; `execute()` returns the alias that served and the attempt count; `executeStream()` falls back before the first chunk and commits after it. |
| `FallbackService` | retryable error triggers attempt 2; non-retryable does not; two failures surface the last error; fallback log names both models. |
| `ApiKeyGuard` / `ApiKeyService` | missing header, wrong scheme, wrong prefix, unknown, revoked, valid attaches identity; generated key hashes to the stored hash. |
| Error mapping | each adapter mapper: 429 / 5xx / 529 / connection / timeout / 400 / 401 / 404 → expected code and retryable flag; filter output includes request_id for `RouterError`, Nest exceptions, plain errors. |
| Adapter mappers | unified → provider request; provider → unified response and usage; scripted stream events → ordered chunks. SDK clients injected and stubbed. |
| `SseWriter`, `openai-format` | frame format, `[DONE]`, drain handling; completion and chunk objects match OpenAI. |

Integration (`supertest`, full Nest app, Express):

- `ProviderRegistry` overridden with scripted fakes; `ApiKeyService` and `UsageService` overridden with Jest mocks. No Postgres.
- 401 without key · 400 bad body, `tools`, three models · 404 unknown alias · 200 per provider · SSE role, deltas, finish, `[DONE]` · 503 from first fake falls back · 400 from first fake does not · unconfigured first provider falls back · one usage record per request with correct status · `x-request-id` on success and error.
- `npm run test:db`: migrations against the Compose Postgres, key creation through `ApiKeyService`, one usage row through the real `UsageService`.

## 7. Implementation order

| # | Phase | Deliverables | DoD |
|---|---|---|---|
| 1 | Scaffold | package, tsconfig, Jest, `.env.example`, ConfigModule, request-ID middleware, errors, filter, `/health`. | boots |
| 2 | Database and auth | schema, migration, DatabaseModule, Compose Postgres, key script, ApiKeyService, ApiKeyGuard with tests. | 2 |
| 3 | Registry, routing, fallback | ModelRegistry, ProviderRegistry, RoutingService, FallbackService, unit tests. | 8 groundwork |
| 4 | Providers and endpoint, non-streaming | three adapters and mappers with error-mapping tests, ChatController / ChatService / DTOs, openai-format, FakeProvider, e2e tests. | 3, 4, 5, 6 |
| 5 | Usage and fallback end to end | UsageService wired into ChatService, `models[]` DTO rules, fallback e2e cases, db-backed suite. | 8, 9 |
| 6 | Streaming | `stream()` on all adapters, `executeStream()`, SseWriter, disconnect handling, streaming e2e. | 7 |
| 7 | Docker and close-out | multi-stage Dockerfile, `app` service with migrate-then-start, healthcheck, README, full test run. | 1, 10 |

## 8. Open items

- Confirm the upstream defaults for `openai/gpt-5` and `google/gemini-2.5-pro` against current provider docs. Both are env-overridable, so this does not block the build.
