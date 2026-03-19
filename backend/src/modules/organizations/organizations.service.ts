import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  SetupOrganizationDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(organizationId: string): Promise<object> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async setup(
    organizationId: string,
    dto: SetupOrganizationDto,
  ): Promise<object> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    // Only callable once (if name is already meaningfully set, reject)
    const defaultNames = ['My Organization', ''];
    if (org.name && !defaultNames.includes(org.name)) {
      throw new BadRequestException('Organization has already been set up');
    }

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        name: dto.name,
        defaultTimezone: dto.defaultTimezone,
        defaultLocale: dto.defaultLocale,
        emailFooter: dto.emailFooter,
        enforceMfa: dto.enforceMfa,
        logoUrl: dto.logoUrl,
      },
    });
    return updated;
  }

  async update(
    organizationId: string,
    dto: UpdateOrganizationDto,
  ): Promise<object> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.defaultTimezone !== undefined && {
          defaultTimezone: dto.defaultTimezone,
        }),
        ...(dto.defaultLocale !== undefined && {
          defaultLocale: dto.defaultLocale,
        }),
        ...(dto.emailFooter !== undefined && { emailFooter: dto.emailFooter }),
        ...(dto.enforceMfa !== undefined && { enforceMfa: dto.enforceMfa }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.maxMailboxes !== undefined && {
          maxMailboxes: dto.maxMailboxes,
        }),
        ...(dto.maxUsers !== undefined && { maxUsers: dto.maxUsers }),
        ...(dto.maxStorageGb !== undefined && {
          maxStorageGb: dto.maxStorageGb,
        }),
      },
    });
    return updated;
  }
}
