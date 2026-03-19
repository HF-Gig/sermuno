import { Module } from '@nestjs/common';
import { SignaturesService } from './signatures.service';
import { SignaturesController } from './signatures.controller';
import { PrismaService } from '../../database/prisma.service';

@Module({
  controllers: [SignaturesController],
  providers: [SignaturesService, PrismaService],
  exports: [SignaturesService],
})
export class SignaturesModule {}
