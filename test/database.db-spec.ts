import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { ApiKeyService } from '../src/auth/api-key.service';
import { createDatabase, Database } from '../src/database/database.module';
import { runMigrations } from '../src/database/migrate';
import { apiKeys, usage } from '../src/database/schema';
import { UsageService } from '../src/usage/usage.service';

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('database (real Postgres)', () => {
  let pool: Pool;
  let db: Database;
  const created: string[] = [];

  beforeAll(async () => {
    await runMigrations(url as string);
    pool = new Pool({ connectionString: url });
    db = createDatabase(pool);
  });

  afterAll(async () => {
    for (const id of created) {
      await db.delete(usage).where(eq(usage.apiKeyId, id));
      await db.delete(apiKeys).where(eq(apiKeys.id, id));
    }
    await pool.end();
  });

  it('creates a key, stores only its hash, and resolves it while active', async () => {
    const service = new ApiKeyService(db);
    const { id, key } = await service.create('db-spec');
    created.push(id);
    expect(key).toMatch(/^lr_/);

    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
    expect(row.keyHash).toBe(ApiKeyService.hash(key));
    expect(row.keyHash).not.toContain(key.slice(3));

    await expect(service.findActive(key)).resolves.toEqual({ id, name: 'db-spec' });
    await expect(service.findActive('lr_unknown')).resolves.toBeNull();

    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
    await expect(service.findActive(key)).resolves.toBeNull();
  });

  it('records one usage row per request and tolerates a duplicate request id', async () => {
    const keys = new ApiKeyService(db);
    const { id } = await keys.create('db-spec-usage');
    created.push(id);

    const service = new UsageService(db);
    const requestId = `lr_req_dbspec_${Date.now()}`;
    await service.record({
      requestId,
      apiKeyId: id,
      model: 'openai/gpt-5',
      provider: 'openai',
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
      latencyMs: 12,
      status: 'success',
    });

    const rows = await db.select().from(usage).where(eq(usage.requestId, requestId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ apiKeyId: id, model: 'openai/gpt-5', provider: 'openai', totalTokens: 5, status: 'success' });
    expect(rows[0].createdAt).toBeInstanceOf(Date);

    // The unique request_id rejects the second insert; the service logs and does not throw.
    await expect(
      service.record({ requestId, apiKeyId: id, model: 'x', provider: null, promptTokens: null, completionTokens: null, totalTokens: null, latencyMs: 1, status: 'error:internal_error' }),
    ).resolves.toBeUndefined();
    expect(await db.select().from(usage).where(eq(usage.requestId, requestId))).toHaveLength(1);
  });
});
