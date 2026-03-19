import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type {
  CreateSlaPolicyDto,
  UpdateSlaPolicyDto,
  SlaTargets,
  BusinessHours,
} from './dto/sla.dto';
import { Prisma } from '@prisma/client';

type SlaMetric = 'first_response' | 'next_response' | 'resolution';

@Injectable()
export class SlaService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: JwtUser) {
    return this.prisma.slaPolicy.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: JwtUser) {
    const policy = await this.prisma.slaPolicy.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!policy) throw new NotFoundException('SLA policy not found');
    return policy;
  }

  async create(dto: CreateSlaPolicyDto, user: JwtUser) {
    return this.prisma.slaPolicy.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name,
        description: dto.description,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
        targets: (dto.targets ?? {}) as Prisma.InputJsonValue,
        businessHours: dto.businessHours
          ? (dto.businessHours as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        holidays: (dto.holidays ?? []) as unknown as Prisma.InputJsonValue,
        escalationRules: (dto.escalationRules ??
          []) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async update(id: string, dto: UpdateSlaPolicyDto, user: JwtUser) {
    await this.findOne(id, user);
    return this.prisma.slaPolicy.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.targets !== undefined && {
          targets: dto.targets as Prisma.InputJsonValue,
        }),
        ...(dto.businessHours !== undefined && {
          businessHours: dto.businessHours as unknown as Prisma.InputJsonValue,
        }),
        ...(dto.holidays !== undefined && {
          holidays: dto.holidays as unknown as Prisma.InputJsonValue,
        }),
        ...(dto.escalationRules !== undefined && {
          escalationRules:
            dto.escalationRules as unknown as Prisma.InputJsonValue,
        }),
      },
    });
  }

  async remove(id: string, user: JwtUser) {
    await this.findOne(id, user);
    await this.prisma.slaPolicy.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  computeDeadline(
    createdAt: Date,
    priority: string,
    targets: SlaTargets,
    businessHours: BusinessHours | null,
    metric: SlaMetric = 'first_response',
  ): Date | null {
    const prio = priority.toLowerCase() as keyof SlaTargets;
    const target = targets[prio];
    if (!target) return null;

    const minutes = this.getTargetMinutes(target, metric);
    if (minutes === null) return null;

    if (!businessHours) {
      return new Date(createdAt.getTime() + minutes * 60_000);
    }

    return this.addBusinessMinutes(createdAt, minutes, businessHours);
  }

  resolveThreadDeadlines(
    thread: {
      createdAt: Date;
      priority: string;
      latestInboundAt: Date | null;
      latestOutboundAt: Date | null;
    },
    targets: SlaTargets,
    businessHours: BusinessHours | null,
  ): { firstResponseDueAt: Date | null; resolutionDueAt: Date | null } {
    const resolutionDueAt = this.computeDeadline(
      thread.createdAt,
      thread.priority,
      targets,
      businessHours,
      'resolution',
    );

    if (!thread.latestInboundAt) {
      return { firstResponseDueAt: null, resolutionDueAt };
    }

    if (!thread.latestOutboundAt) {
      return {
        firstResponseDueAt: this.computeDeadline(
          thread.latestInboundAt,
          thread.priority,
          targets,
          businessHours,
          'first_response',
        ),
        resolutionDueAt,
      };
    }

    if (thread.latestInboundAt > thread.latestOutboundAt) {
      return {
        firstResponseDueAt: this.computeDeadline(
          thread.latestInboundAt,
          thread.priority,
          targets,
          businessHours,
          'next_response',
        ),
        resolutionDueAt,
      };
    }

    return { firstResponseDueAt: null, resolutionDueAt };
  }

  private getTargetMinutes(
    target: SlaTargets[keyof SlaTargets],
    metric: SlaMetric,
  ): number | null {
    if (!target) return null;
    if (metric === 'resolution') {
      return target.resolutionMinutes ?? null;
    }
    if (metric === 'next_response') {
      return target.nextResponseMinutes ?? target.firstResponseMinutes ?? null;
    }
    return target.firstResponseMinutes ?? null;
  }

  private addBusinessMinutes(
    start: Date,
    minutes: number,
    bh: BusinessHours,
  ): Date {
    let current = new Date(start.getTime());
    let remaining = minutes;

    while (remaining > 0) {
      if (this.isWithinBusinessHours(current, bh)) {
        remaining--;
      }
      current = new Date(current.getTime() + 60_000);
    }
    return current;
  }

  private isWithinBusinessHours(date: Date, bh: BusinessHours): boolean {
    const dayOfWeek = date.getUTCDay();
    const hours = date.getUTCHours();
    const mins = date.getUTCMinutes();
    const currentMinutes = hours * 60 + mins;

    const schedule = this.getDaySchedule(dayOfWeek, bh);
    if (!schedule?.enabled) {
      return false;
    }

    const [startH, startM] = schedule.startTime.split(':').map(Number);
    const [endH, endM] = schedule.endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  private getDaySchedule(
    dayOfWeek: number,
    bh: BusinessHours,
  ): { enabled: boolean; startTime: string; endTime: string } | null {
    const explicitDays = bh.days ?? null;
    if (explicitDays) {
      const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dayOfWeek];
      const day =
        explicitDays[key] ??
        explicitDays[String(dayOfWeek)] ??
        explicitDays[key.toUpperCase()];

      if (day) {
        return {
          enabled: Boolean(day.enabled),
          startTime: day.startTime || bh.startTime || '09:00',
          endTime: day.endTime || bh.endTime || '17:00',
        };
      }
    }

    if (!bh.daysOfWeek || !bh.startTime || !bh.endTime) {
      return null;
    }

    return {
      enabled: bh.daysOfWeek.includes(dayOfWeek),
      startTime: bh.startTime,
      endTime: bh.endTime,
    };
  }
}
