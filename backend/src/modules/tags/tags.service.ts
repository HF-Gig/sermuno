import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type { CreateTagDto, UpdateTagDto } from './dto/tag.dto';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: JwtUser) {
    // Scope enforcement: organization tags visible to all; personal tags only to creator
    return this.prisma.tag.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        OR: [
          { scope: 'organization' },
          { scope: 'personal', ownerId: user.sub },
        ],
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateTagDto, user: JwtUser) {
    const scope = dto.scope ?? 'organization';
    return this.prisma.tag.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name,
        color: dto.color,
        scope,
        ownerId: scope === 'personal' ? user.sub : null,
      },
    });
  }

  async update(id: string, dto: UpdateTagDto, user: JwtUser) {
    const tag = await this.prisma.tag.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!tag) throw new NotFoundException('Tag not found');

    // Personal tags can only be updated by their owner; org tags require admin/manager
    if (tag.scope === 'personal' && tag.ownerId !== user.sub) {
      throw new ForbiddenException("Cannot modify another user's personal tag");
    }

    return this.prisma.tag.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.scope !== undefined && { scope: dto.scope }),
      },
    });
  }

  async remove(id: string, user: JwtUser) {
    const tag = await this.prisma.tag.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!tag) throw new NotFoundException('Tag not found');

    if (tag.scope === 'personal' && tag.ownerId !== user.sub) {
      throw new ForbiddenException("Cannot delete another user's personal tag");
    }

    await this.prisma.tag.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
