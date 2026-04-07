import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { PrismaService } from '../../database/prisma.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [OrganizationsService, PrismaService],
  controllers: [OrganizationsController],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
