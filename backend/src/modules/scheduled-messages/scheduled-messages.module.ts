import { Module } from '@nestjs/common';
import { ScheduledMessagesController } from './scheduled-messages.controller';
import { ScheduledMessagesService } from './scheduled-messages.service';
import { PrismaService } from '../../database/prisma.service';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [MessagesModule],
  controllers: [ScheduledMessagesController],
  providers: [ScheduledMessagesService, PrismaService],
})
export class ScheduledMessagesModule {}
