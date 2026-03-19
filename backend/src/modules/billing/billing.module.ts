import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { PrismaService } from '../../database/prisma.service';

@Module({
  providers: [BillingService, PrismaService],
  controllers: [BillingController],
  exports: [BillingService],
})
export class BillingModule {}
