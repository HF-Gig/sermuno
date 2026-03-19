import { Module } from '@nestjs/common';
import { SlaService } from './sla.service';
import { SlaController } from './sla.controller';
import { PrismaService } from '../../database/prisma.service';

@Module({
  controllers: [SlaController],
  providers: [SlaService, PrismaService],
  exports: [SlaService],
})
export class SlaModule {}
