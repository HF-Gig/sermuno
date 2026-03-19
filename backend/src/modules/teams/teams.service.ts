import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateTeamDto,
  UpdateTeamDto,
  AddTeamMemberDto,
  UpdateTeamMemberDto,
} from './dto/team.dto';
import { TeamRole } from '@prisma/client';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(organizationId: string): Promise<object[]> {
    return this.prisma.team.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        _count: {
          select: {
            members: true,
            assignedThreads: true,
          },
        },
        mailboxAccess: {
          select: {
            mailboxId: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(organizationId: string, id: string): Promise<object> {
    const team = await this.prisma.team.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        _count: {
          select: {
            members: true,
            assignedThreads: true,
          },
        },
        mailboxAccess: {
          select: {
            mailboxId: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  async create(organizationId: string, dto: CreateTeamDto): Promise<object> {
    return this.prisma.team.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description,
      },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateTeamDto,
  ): Promise<object> {
    const team = await this.prisma.team.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!team) throw new NotFoundException('Team not found');

    return this.prisma.team.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });
  }

  async remove(organizationId: string, id: string): Promise<void> {
    const team = await this.prisma.team.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!team) throw new NotFoundException('Team not found');
    await this.prisma.team.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.prisma.mailboxAccess.deleteMany({ where: { teamId: id } });
  }

  async addMember(
    organizationId: string,
    teamId: string,
    dto: AddTeamMemberDto,
  ): Promise<object> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId, deletedAt: null },
    });
    if (!team) throw new NotFoundException('Team not found');

    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, organizationId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.prisma.teamMember.findUnique({
      where: { userId_teamId: { userId: dto.userId, teamId } },
    });
    if (existing)
      throw new ConflictException('User is already a member of this team');

    return this.prisma.teamMember.create({
      data: {
        teamId,
        userId: dto.userId,
        role: (dto.role ?? 'member') as TeamRole,
      },
    });
  }

  async updateMember(
    organizationId: string,
    teamId: string,
    userId: string,
    dto: UpdateTeamMemberDto,
  ): Promise<object> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId, deletedAt: null },
    });
    if (!team) throw new NotFoundException('Team not found');

    const member = await this.prisma.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });
    if (!member) throw new NotFoundException('Team member not found');

    return this.prisma.teamMember.update({
      where: { userId_teamId: { userId, teamId } },
      data: { role: dto.role as TeamRole },
    });
  }

  async removeMember(
    organizationId: string,
    teamId: string,
    userId: string,
  ): Promise<void> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId, deletedAt: null },
    });
    if (!team) throw new NotFoundException('Team not found');

    const member = await this.prisma.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });
    if (!member) throw new NotFoundException('Team member not found');

    await this.prisma.teamMember.delete({
      where: { userId_teamId: { userId, teamId } },
    });
  }
}
