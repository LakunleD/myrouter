import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { createDatabase } from './database.module';

/** Applies the committed migrations under ./drizzle. Used locally and by the Docker entrypoint. */
export async function runMigrations(databaseUrl: string, migrationsFolder = resolve(process.cwd(), 'drizzle')): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await migrate(createDatabase(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log('Migrations applied');
    })
    .catch((err) => {
      console.error('Migration failed', err);
      process.exit(1);
    });
}
