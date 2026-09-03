# Claude Code Build Spec: LLM Router MVP

Build an MVP of an OpenRouter-style LLM gateway.

## Goal

Create a single API that allows a client to send OpenAI-compatible chat completion requests and route them to different LLM providers.

The MVP should support:

1. OpenAI
2. Anthropic
3. Google Gemini
4. API key authentication
5. Model-based routing
6. Basic fallback
7. Streaming
8. Usage tracking
9. Normalized errors

Do not build billing, dashboards, organizations, Kafka, Redis, Kubernetes, semantic routing, advanced provider health scoring, or microservices.

## Tech Stack

Use:

* TypeScript
* NestJS
* PostgreSQL
* Drizzle ORM
* OpenTelemetry where useful
* Jest
* Docker
* Docker Compose

Keep this as a modular monolith.

## Public API

Implement:

```text
POST /v1/chat/completions
```

The API should be broadly compatible with the OpenAI chat completions format.

Example:

```json
{
  "model": "anthropic/claude-sonnet",
  "messages": [
    {
      "role": "user",
      "content": "Explain Kafka consumer groups"
    }
  ],
  "stream": false
}
```

Authentication:

```text
Authorization: Bearer lr_xxxxxxxxx
```

## Architecture

Use these NestJS modules:

```text
src/
├── app.module.ts
├── chat/
├── auth/
├── providers/
├── routing/
├── models/
├── usage/
├── database/
└── telemetry/
```

### Chat Module

Responsible for:

* `/v1/chat/completions`
* request validation
* calling the routing layer
* returning normalized responses

Controllers must remain thin.

### Provider Module

Create a common provider interface.

```typescript
interface LLMProvider {
  readonly name: string;

  supports(model: string): boolean;

  chat(
    request: UnifiedChatRequest
  ): Promise<UnifiedChatResponse>;

  stream(
    request: UnifiedChatRequest
  ): AsyncIterable<UnifiedStreamChunk>;
}
```

Implement:

```text
OpenAIProvider
AnthropicProvider
GoogleProvider
```

Provider-specific request and response formats must not leak outside the provider implementation.

### Routing Module

The routing service receives a requested model and resolves the correct provider.

Initial routing:

```text
openai/* -> OpenAI
anthropic/* -> Anthropic
google/* -> Google
```

Do not implement intelligent routing yet.

### Fallback

Support an optional list of models.

Example:

```json
{
  "models": [
    "anthropic/claude-sonnet",
    "openai/gpt"
  ],
  "messages": [...]
}
```

Try models in order.

Retry/fallback only for:

```text
429
500
502
503
504
network errors
timeouts
```

Do not fallback for validation errors, authentication errors, unsupported parameters, or safety/content-policy responses.

Maximum two attempts for the MVP.

### API Key Authentication

Create API keys using the format:

```text
lr_<random-secret>
```

Store only a hash of the API key.

Create a NestJS guard that validates:

```text
Authorization: Bearer <key>
```

Database table:

```text
api_keys

id
name
key_hash
created_at
revoked_at
```

Provide a CLI command or simple script to create API keys.

No user registration or dashboard is required.

### Model Registry

For the MVP, keep the model registry in application configuration.

Example:

```typescript
{
  "openai/gpt": {
    provider: "openai"
  },
  "anthropic/claude-sonnet": {
    provider: "anthropic"
  },
  "google/gemini-pro": {
    provider: "google"
  }
}
```

Do not build database-backed model management yet.

### Usage Tracking

Store usage after each request.

Table:

```text
usage

id
request_id
api_key_id
model
provider
prompt_tokens
completion_tokens
total_tokens
latency_ms
status
created_at
```

Usage persistence should not alter the provider response.

If token information is returned by the provider, use it.

### Request IDs

Every incoming request must receive a unique request ID.

Example:

```text
lr_req_xxxxxxxxx
```

Include it in:

* logs
* usage records
* errors
* response headers

### Error Normalization

Return errors using one consistent structure.

Example:

```json
{
  "error": {
    "message": "Upstream provider temporarily unavailable",
    "type": "provider_unavailable",
    "code": "provider_unavailable",
    "request_id": "lr_req_123"
  }
}
```

Create internal error types such as:

```text
INVALID_REQUEST
INVALID_API_KEY
MODEL_NOT_FOUND
PROVIDER_UNAVAILABLE
PROVIDER_RATE_LIMITED
PROVIDER_TIMEOUT
INTERNAL_ERROR
```

Do not expose raw provider errors unnecessarily.

### Streaming

Support:

```json
{
  "stream": true
}
```

Use Server-Sent Events.

Normalize provider streaming output into an OpenAI-compatible stream format.

Do not buffer the entire response before returning it.

### Logging

Use the default logger in NestJS for starters.

Log:

* request_id
* model
* provider
* status
* latency
* fallback attempts
* token usage

Do not log prompts or completions by default.

### Database

Use PostgreSQL with Drizzle.

Initial tables:

```text
api_keys
usage
```

Avoid creating unnecessary entities.

### Configuration

Use environment variables for provider credentials:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_API_KEY
DATABASE_URL
PORT
```

Provide:

```text
.env.example
```

Never commit provider credentials.

## Testing

Write unit tests for:

* model routing
* fallback behavior
* provider resolution
* API key validation
* error mapping

Write integration tests for:

```text
POST /v1/chat/completions
```

Mock upstream LLM providers during automated tests.

## Docker

Provide:

```text
Dockerfile
docker-compose.yml
```

Docker Compose should start:

```text
app
postgres
```

## Development Principles

1. Keep the implementation simple.
2. Do not introduce abstractions before they are required.
3. Do not create microservices.
4. Keep provider-specific logic inside provider adapters.
5. Keep controllers thin.
6. Prefer explicit code over complex frameworks or patterns.
7. Use dependency injection so providers can be mocked easily.
8. Write tests for routing and failure scenarios.
9. Ensure streaming clients disconnect cleanly.
10. Avoid storing prompts or responses.

## Definition of Done

The MVP is complete when:

1. The app starts locally using Docker Compose.
2. An API key can be generated.
3. A request can be sent using an OpenAI-compatible client.
4. The request can target OpenAI.
5. The same API can target Anthropic by changing the model.
6. The same API can target Gemini by changing the model.
7. Streaming works.
8. Failed providers can trigger a configured fallback.
9. Usage is persisted in PostgreSQL.
10. All core tests pass.

Before implementing anything, inspect the repository and produce an implementation plan.

Do not write code during the planning step.

Identify:

* modules
* files
* interfaces
* database schema
* request flow
* test strategy
* implementation order

Then wait for implementation instructions.
