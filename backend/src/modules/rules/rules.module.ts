import { Module } from '@nestjs/common';
import { RulesService } from './rules.service';
import { RulesController } from './rules.controller';
import { RulesEngineService } from './rules-engine.service';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [NotificationsModule, WebhooksModule],
  controllers: [RulesController],
  providers: [RulesService, RulesEngineService, PrismaService],
  exports: [RulesService, RulesEngineService],
})
export class RulesModule {}
