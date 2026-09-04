import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { UsageService } from './usage.service';

@Module({
  imports: [DatabaseModule],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
