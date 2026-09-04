import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { RoutingModule } from './routing/routing.module';
import { RequestIdMiddleware } from './telemetry/request-id.middleware';
import { TelemetryModule } from './telemetry/telemetry.module';

@Module({
  imports: [ConfigModule, TelemetryModule, DatabaseModule, AuthModule, RoutingModule, ChatModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
