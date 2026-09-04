import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoutingModule } from '../routing/routing.module';
import { UsageModule } from '../usage/usage.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [AuthModule, RoutingModule, UsageModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
