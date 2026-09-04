import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoutingModule } from '../routing/routing.module';
import { UsageModule } from '../usage/usage.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { SseWriter } from './sse-writer';

@Module({
  imports: [AuthModule, RoutingModule, UsageModule],
  controllers: [ChatController],
  providers: [ChatService, SseWriter],
})
export class ChatModule {}
