import { Module } from '@nestjs/common';
import { RequestIdMiddleware } from './request-id.middleware';

@Module({
  providers: [RequestIdMiddleware],
  exports: [RequestIdMiddleware],
})
export class TelemetryModule {}
