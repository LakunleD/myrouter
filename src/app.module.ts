import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { RequestIdMiddleware } from './telemetry/request-id.middleware';
import { TelemetryModule } from './telemetry/telemetry.module';

@Module({
  imports: [ConfigModule, TelemetryModule, DatabaseModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
