import 'dotenv/config';
import { Pool } from 'pg';
import { ApiKeyService } from '../src/auth/api-key.service';
import { createDatabase } from '../src/database/database.module';

/**
 * Usage: npm run key:create -- --name "local dev"
 * Prints the plaintext key once. Only its hash is stored.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const nameFlag = args.indexOf('--name');
  const name = nameFlag >= 0 ? args[nameFlag + 1] : args[0];
  if (!name) {
    console.error('Usage: create-api-key --name <name>');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  try {
    const service = new ApiKeyService(createDatabase(pool));
    const { id, key } = await service.create(name);
    console.log(`Created API key "${name}" (id ${id}).`);
    console.log('Store it now; it will not be shown again:');
    console.log(key);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Failed to create API key', err);
  process.exit(1);
});
