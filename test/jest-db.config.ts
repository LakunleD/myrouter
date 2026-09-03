import type { Config } from 'jest';

// Runs against a real Postgres. Requires DATABASE_URL (see docker-compose.yml).
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  testRegex: 'test/.*\\.db-spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  testTimeout: 30000,
};

export default config;
