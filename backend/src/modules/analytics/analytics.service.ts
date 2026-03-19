import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

interface DateRange {
  from?: string;
  to?: string;
  period?: string;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user: JwtUser, range: DateRange) {
    const mailboxIds = await this.getAccessibleMailboxIds(user);
    if (mailboxIds && mailboxIds.length === 0) {
      return {
        totalOpenThreads: 0,
        averageResponseTimeMinutes: 0,
        slaCompliance: 0,
      };
    }

    const threadWhere = this.buildThreadWhere(
      user.organizationId,
      range,
      mailboxIds,
    );
    const respondedWhere = {
      ...threadWhere,
      firstResponseAt: { not: null as null | Date },
    };
    const slaWhere = {
      ...threadWhere,
      slaPolicyId: { not: null as null | string },
    };

    const [
      totalOpenThreads,
      respondedThreads,
      slaCoveredThreads,
      slaCompliantThreads,
    ] = await Promise.all([
      this.prisma.thread.count({
        where: {
          ...threadWhere,
          status: { in: ['NEW', 'OPEN', 'PENDING', 'SNOOZED'] },
        },
      }),
      this.prisma.thread.findMany({
        where: respondedWhere,
        select: { createdAt: true, firstResponseAt: true },
      }),
      this.prisma.thread.count({ where: slaWhere }),
      this.prisma.thread.count({ where: { ...slaWhere, slaBreached: false } }),
    ]);

    const totalResponseMinutes = respondedThreads.reduce((sum, thread) => {
      if (!thread.firstResponseAt) return sum;
      return (
        sum +
        (thread.firstResponseAt.getTime() - thread.createdAt.getTime()) / 60000
      );
    }, 0);

    return {
      totalOpenThreads,
      averageResponseTimeMinutes: respondedThreads.length
        ? Number((totalResponseMinutes / respondedThreads.length).toFixed(1))
        : 0,
      slaCompliance:
        slaCoveredThreads > 0
          ? Number(((slaCompliantThreads / slaCoveredThreads) * 100).toFixed(1))
          : 0,
    };
  }

  async volume(user: JwtUser, range: DateRange) {
    const mailboxIds = await this.getAccessibleMailboxIds(user);
    if (mailboxIds && mailboxIds.length === 0) {
      return [];
    }

    const from = range.from
      ? new Date(range.from)
      : new Date(Date.now() - 30 * 86400000);
    const to = range.to ? new Date(range.to) : new Date();
    const period = this.normalizePeriod(range.period);
    const bucket = Prisma.raw(`'${period}'`);
    const mailboxFilter = this.buildMailboxFilterSql('t', mailboxIds);

    const rows = await this.prisma.$queryRaw<
      { bucket: Date; messages: bigint }[]
    >(Prisma.sql`
      SELECT
        date_trunc(${bucket}, m."createdAt") AS bucket,
        COUNT(*) AS messages
      FROM messages m
      JOIN threads t ON t.id = m."threadId"
      WHERE t."organizationId" = ${user.organizationId}
        AND m."createdAt" >= ${from}
        AND m."createdAt" <= ${to}
        ${mailboxFilter}
      GROUP BY bucket
      ORDER BY bucket ASC
    `);

    return rows.map((row) => ({
      bucket: row.bucket,
      label: row.bucket.toISOString(),
      messages: Number(row.messages),
    }));
  }

  async topSenders(user: JwtUser, range: DateRange) {
    const mailboxIds = await this.getAccessibleMailboxIds(user);
    if (mailboxIds && mailboxIds.length === 0) {
      return [];
    }

    const from = range.from
      ? new Date(range.from)
      : new Date(Date.now() - 30 * 86400000);
    const to = range.to ? new Date(range.to) : new Date();
    const mailboxFilter = this.buildMailboxFilterSql('t', mailboxIds);

    const rows = await this.prisma.$queryRaw<
      { email: string; count: bigint }[]
    >(Prisma.sql`
      SELECT m."fromEmail" AS email, COUNT(*) AS count
      FROM messages m
      JOIN threads t ON t.id = m."threadId"
      WHERE t."organizationId" = ${user.organizationId}
        AND m.direction = 'INBOUND'
        AND m."createdAt" >= ${from}
        AND m."createdAt" <= ${to}
        ${mailboxFilter}
      GROUP BY m."fromEmail"
      ORDER BY count DESC
      LIMIT 10
    `);

    return rows.map((row) => ({ email: row.email, count: Number(row.count) }));
  }

  async topDomains(user: JwtUser, range: DateRange) {
    const mailboxIds = await this.getAccessibleMailboxIds(user);
    if (mailboxIds && mailboxIds.length === 0) {
      return [];
    }

    const from = range.from
      ? new Date(range.from)
      : new Date(Date.now() - 30 * 86400000);
    const to = range.to ? new Date(range.to) : new Date();
    const mailboxFilter = this.buildMailboxFilterSql('t', mailboxIds);

    const rows = await this.prisma.$queryRaw<
      { domain: string; count: bigint }[]
    >(Prisma.sql`
      SELECT split_part(m."fromEmail", '@', 2) AS domain, COUNT(*) AS count
      FROM messages m
      JOIN threads t ON t.id = m."threadId"
      WHERE t."organizationId" = ${user.organizationId}
        AND m.direction = 'INBOUND'
        AND m."fromEmail" LIKE '%@%'
        AND m."createdAt" >= ${from}
        AND m."createdAt" <= ${to}
        ${mailboxFilter}
      GROUP BY domain
      ORDER BY count DESC
      LIMIT 10
    `);

    return rows.map((row) => ({
      domain: row.domain,
      count: Number(row.count),
    }));
  }

  async busyHours(user: JwtUser, range: DateRange) {
    const mailboxIds = await this.getAccessibleMailboxIds(user);
    const emptyGrid = Array.from({ length: 7 }, (_, day) => ({
      day,
      hours: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
    }));
    if (mailboxIds && mailboxIds.length === 0) {
      return emptyGrid;
    }

    const from = range.from
      ? new Date(range.from)
      : new Date(Date.now() - 30 * 86400000);
    const to = range.to ? new Date(range.to) : new Date();
    const mailboxFilter = this.buildMailboxFilterSql('t', mailboxIds);

    const rows = await this.prisma.$queryRaw<
      { day: number; hour: number; count: bigint }[]
    >(Prisma.sql`
      SELECT
        extract(dow from m."createdAt") AS day,
        extract(hour from m."createdAt") AS hour,
        COUNT(*) AS count
      FROM messages m
      JOIN threads t ON t.id = m."threadId"
      WHERE t."organizationId" = ${user.organizationId}
        AND m."createdAt" >= ${from}
        AND m."createdAt" <= ${to}
        ${mailboxFilter}
      GROUP BY day, hour
      ORDER BY day ASC, hour ASC
    `);

    const countMap = new Map(
      rows.map((row) => [
        `${Number(row.day)}-${Number(row.hour)}`,
        Number(row.count),
      ]),
    );
    return emptyGrid.map((row) => ({
      day: row.day,
      hours: row.hours.map((entry) => ({
        hour: entry.hour,
        count: countMap.get(`${row.day}-${entry.hour}`) ?? 0,
      })),
    }));
  }

  async teamPerformance(user: JwtUser, range: DateRange) {
    const mailboxIds = await this.getAccessibleMailboxIds(user);
    if (mailboxIds && mailboxIds.length === 0) {
      return [];
    }

    const threads = await this.prisma.thread.findMany({
      where: this.buildThreadWhere(user.organizationId, range, mailboxIds),
      select: {
        assignedUserId: true,
        assignedUser: { select: { fullName: true, email: true } },
        createdAt: true,
        firstResponseAt: true,
        status: true,
        slaPolicyId: true,
        slaBreached: true,
      },
    });

    const grouped = new Map<
      string,
      {
        userId: string;
        name: string;
        totalResponseMinutes: number;
        respondedCount: number;
        resolvedThreads: number;
        slaCovered: number;
        slaCompliant: number;
      }
    >();

    for (const thread of threads) {
      const key = thread.assignedUserId ?? 'unassigned';
      const current = grouped.get(key) ?? {
        userId: key,
        name:
          thread.assignedUser?.fullName ||
          thread.assignedUser?.email ||
          'Unassigned',
        totalResponseMinutes: 0,
        respondedCount: 0,
        resolvedThreads: 0,
        slaCovered: 0,
        slaCompliant: 0,
      };

      if (thread.firstResponseAt) {
        current.totalResponseMinutes +=
          (thread.firstResponseAt.getTime() - thread.createdAt.getTime()) /
          60000;
        current.respondedCount += 1;
      }
      if (thread.status === 'CLOSED') {
        current.resolvedThreads += 1;
      }
      if (thread.slaPolicyId) {
        current.slaCovered += 1;
        if (!thread.slaBreached) current.slaCompliant += 1;
      }

      grouped.set(key, current);
    }

    return Array.from(grouped.values())
      .map((entry) => ({
        userId: entry.userId,
        name: entry.name,
        responseTimeMinutes: entry.respondedCount
          ? Number(
              (entry.totalResponseMinutes / entry.respondedCount).toFixed(1),
            )
          : 0,
        resolvedThreads: entry.resolvedThreads,
        slaCompliance: entry.slaCovered
          ? Number(((entry.slaCompliant / entry.slaCovered) * 100).toFixed(1))
          : 0,
      }))
      .sort((a, b) => b.resolvedThreads - a.resolvedThreads);
  }

  private normalizePeriod(period?: string) {
    if (period === 'week' || period === 'month') return period;
    return 'day';
  }

  private buildThreadWhere(
    orgId: string,
    range: DateRange,
    mailboxIds: string[] | null,
  ) {
    return {
      organizationId: orgId,
      ...(mailboxIds ? { mailboxId: { in: mailboxIds } } : {}),
      ...(range.from || range.to
        ? {
            createdAt: {
              ...(range.from ? { gte: new Date(range.from) } : {}),
              ...(range.to ? { lte: new Date(range.to) } : {}),
            },
          }
        : {}),
    };
  }

  private buildMailboxFilterSql(alias: string, mailboxIds: string[] | null) {
    if (!mailboxIds) return Prisma.empty;
    if (mailboxIds.length === 0) return Prisma.sql`AND 1 = 0`;
    return Prisma.sql`AND ${Prisma.raw(`"${alias}"."mailboxId"`)} IN (${Prisma.join(mailboxIds)})`;
  }

  private async getAccessibleMailboxIds(
    user: JwtUser,
  ): Promise<string[] | null> {
    if (
      this.isAdmin(user) ||
      this.hasPermission(user, 'mailboxes:manage') ||
      this.hasPermission(user, 'organization:manage')
    ) {
      return null;
    }

    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    const teamIds = memberships.map((membership) => membership.teamId);

    const accesses = await this.prisma.mailboxAccess.findMany({
      where: {
        OR: [
          { userId: user.sub, canRead: true },
          ...(teamIds.length
            ? [{ teamId: { in: teamIds }, canRead: true }]
            : []),
        ],
      },
      select: { mailboxId: true },
    });

    return Array.from(new Set(accesses.map((access) => access.mailboxId)));
  }

  private hasPermission(user: JwtUser, permission: string) {
    return (
      user.permissions.includes('*') || user.permissions.includes(permission)
    );
  }

  private isAdmin(user: JwtUser) {
    return String(user.role || '').toUpperCase() === 'ADMIN';
  }
}
