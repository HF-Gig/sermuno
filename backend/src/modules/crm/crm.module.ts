import { Module } from '@nestjs/common';
import { CrmService } from './crm.service';
import { CrmController } from './crm.controller';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [CrmController],
  providers: [CrmService, PrismaService],
  exports: [CrmService],
})
export class CrmModule {}
