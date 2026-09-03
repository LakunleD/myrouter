import 'dotenv/config';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { RouterExceptionFilter } from './common/filters/router-exception.filter';
import { APP_CONFIG, AppConfig } from './config/app-config';

export function configureApp(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: '5mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new RouterExceptionFilter());
  app.enableShutdownHooks();
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port);
  new Logger('Bootstrap').log(`Listening on port ${config.port}`);
}

if (require.main === module) {
  bootstrap().catch((err) => {
    new Logger('Bootstrap').error(err);
    process.exit(1);
  });
}
