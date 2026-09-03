import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');
const PG_POOL = Symbol('PG_POOL');

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}

@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (config: AppConfig) => new Pool({ connectionString: config.databaseUrl }),
      inject: [APP_CONFIG],
    },
    {
      provide: DRIZZLE,
      useFactory: (pool: Pool) => createDatabase(pool),
      inject: [PG_POOL],
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
