import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module';
import { ProvidersModule } from '../providers/providers.module';
import { FallbackService } from './fallback.service';
import { RoutingService } from './routing.service';

@Module({
  imports: [ModelsModule, ProvidersModule],
  providers: [RoutingService, FallbackService],
  exports: [RoutingService],
})
export class RoutingModule {}
