import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThreadsService } from './threads.service';
import { ThreadsController } from './threads.controller';
import { PrismaService } from '../../database/prisma.service';
import { WebsocketsModule } from '../websockets/websockets.module';
import { SlaModule } from '../sla/sla.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ConfigModule, WebsocketsModule, SlaModule, NotificationsModule],
  controllers: [ThreadsController],
  providers: [ThreadsService, PrismaService],
  exports: [ThreadsService],
})
export class ThreadsModule {}
