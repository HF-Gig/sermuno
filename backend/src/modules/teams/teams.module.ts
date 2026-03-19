import { Module } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { PrismaService } from '../../database/prisma.service';

@Module({
  providers: [TeamsService, PrismaService],
  controllers: [TeamsController],
  exports: [TeamsService],
})
export class TeamsModule {}
