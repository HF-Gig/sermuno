import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type {
  CreateContactDto,
  UpdateContactDto,
  CreateCompanyDto,
  UpdateCompanyDto,
} from './dto/crm.dto';
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async listContacts(user: JwtUser) {
    const mailboxIds = await this.getAccessibleMailboxIds(user);
    const contacts = await this.prisma.contact.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        ...(mailboxIds
          ? {
              threads: {
                some: {
                  mailboxId: { in: mailboxIds },
                },
              },
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        threads: {
          where: mailboxIds ? { mailboxId: { in: mailboxIds } } : undefined,
          select: {
            id: true,
            updatedAt: true,
            companyId: true,
            messages: {
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    return contacts.map((contact) => this.mapContactList(contact));
  }

  async createContact(dto: CreateContactDto, user: JwtUser) {
    const existing = await this.prisma.contact.findFirst({
      where: {
        organizationId: user.organizationId,
        email: dto.email,
        deletedAt: null,
      },
    });
    if (existing)
      throw new ConflictException('Contact with this email already exists');

    const created = await this.prisma.contact.create({
      data: {
        organizationId: user.organizationId,
        email: dto.email,
        name: dto.fullName,
        fullName: dto.fullName,
        additionalEmails: this.normalizeArray(dto.additionalEmails),
        lifecycleStage: dto.lifecycleStage ?? 'lead',
        phone: this.primaryPhoneValue(dto.phoneNumbers),
        phoneNumbers: this.normalizeArray(dto.phoneNumbers),
        addresses: this.normalizeArray(dto.addresses),
        socialProfiles: this.normalizeArray(dto.socialProfiles),
        customFields: this.normalizeObject(dto.customFields),
        assignedToUserId: dto.assignedToUserId ?? null,
        source: dto.source ?? 'manual',
        avatarUrl: dto.avatarUrl ?? null,
        companyId: dto.companyId ?? null,
      },
    });

    await this.dispatchContactActivity({
      organizationId: user.organizationId,
      actor: user,
      contactId: created.id,
      contactEmail: created.email,
      contactName: created.fullName || created.name || created.email,
      activity: 'created',
      preferredUserId: created.assignedToUserId ?? undefined,
    });

    return created;
  }

  async getContact(id: string, user: JwtUser) {
    const mailboxIds = await this.getAccessibleMailboxIds(user);
    const contact = await this.prisma.contact.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        deletedAt: null,
        ...(mailboxIds
          ? {
              threads: {
                some: { mailboxId: { in: mailboxIds } },
              },
            }
          : {}),
      },
      include: {
        threads: {
          where: mailboxIds ? { mailboxId: { in: mailboxIds } } : undefined,
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            mailboxId: true,
            subject: true,
            status: true,
            priority: true,
            contactId: true,
            companyId: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { messages: true, notes: true } },
            messages: {
              select: {
                id: true,
                fromEmail: true,
                subject: true,
                createdAt: true,
                bodyText: true,
                bodyHtml: true,
              },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    const linkedMessages = contact.threads.flatMap((thread) =>
      thread.messages.map((message) => ({
        id: message.id,
        threadId: thread.id,
        fromEmail: message.fromEmail,
        subject: message.subject,
        createdAt: message.createdAt,
        preview: message.bodyText || message.bodyHtml || '',
      })),
    );

    return {
      ...this.mapContactBase(contact),
      linkedThreads: contact.threads.map((thread) => ({
        id: thread.id,
        mailboxId: thread.mailboxId,
        subject: thread.subject,
        status: thread.status,
        priority: thread.priority,
        contactId: thread.contactId,
        companyId: thread.companyId,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        messagesInThread: thread._count.messages,
        internalNotes: thread._count.notes,
      })),
      linkedMessages,
    };
  }

  async updateContact(id: string, dto: UpdateContactDto, user: JwtUser) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    if (dto.email && dto.email !== contact.email) {
      const conflict = await this.prisma.contact.findFirst({
        where: {
          organizationId: user.organizationId,
          email: dto.email,
          deletedAt: null,
        },
      });
      if (conflict)
        throw new ConflictException('Contact with this email already exists');
    }

    const updated = await this.prisma.contact.update({
      where: { id },
      data: {
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.fullName !== undefined && {
          name: dto.fullName,
          fullName: dto.fullName,
        }),
        ...(dto.additionalEmails !== undefined && {
          additionalEmails: this.normalizeArray(dto.additionalEmails),
        }),
        ...(dto.lifecycleStage !== undefined && {
          lifecycleStage: dto.lifecycleStage,
        }),
        ...(dto.phoneNumbers !== undefined && {
          phone: this.primaryPhoneValue(dto.phoneNumbers),
          phoneNumbers: this.normalizeArray(dto.phoneNumbers),
        }),
        ...(dto.addresses !== undefined && {
          addresses: this.normalizeArray(dto.addresses),
        }),
        ...(dto.socialProfiles !== undefined && {
          socialProfiles: this.normalizeArray(dto.socialProfiles),
        }),
        ...(dto.customFields !== undefined && {
          customFields: this.normalizeObject(dto.customFields),
        }),
        ...(dto.assignedToUserId !== undefined && {
          assignedToUserId: dto.assignedToUserId || null,
        }),
        ...(dto.source !== undefined && { source: dto.source }),
        ...(dto.avatarUrl !== undefined && {
          avatarUrl: dto.avatarUrl || null,
        }),
        ...(dto.companyId !== undefined && {
          companyId: dto.companyId || null,
        }),
      },
    });

    await this.dispatchContactActivity({
      organizationId: user.organizationId,
      actor: user,
      contactId: updated.id,
      contactEmail: updated.email,
      contactName: updated.fullName || updated.name || updated.email,
      activity: 'updated',
      preferredUserId: updated.assignedToUserId ?? undefined,
    });

    return updated;
  }

  async deleteContact(id: string, user: JwtUser): Promise<void> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    await this.prisma.contact.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async listCompanies(user: JwtUser) {
    const companies = await this.prisma.company.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        threads: { select: { id: true } },
        contacts: { select: { id: true } },
      },
    });

    return companies.map((company) => ({
      id: company.id,
      tenantId: company.organizationId,
      name: company.name,
      primaryDomain: company.primaryDomain || company.domain || null,
      additionalDomains: this.readStringArray(company.additionalDomains),
      customFields: this.readObject(company.customFields),
      threadCount: company.threads.length,
      contactCount: company.contacts.length,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    }));
  }

  async createCompany(dto: CreateCompanyDto, user: JwtUser) {
    return this.prisma.company.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name,
        domain: dto.primaryDomain ?? null,
        primaryDomain: dto.primaryDomain ?? null,
        additionalDomains: this.normalizeArray(dto.additionalDomains),
        customFields: this.normalizeObject(dto.customFields),
        logoUrl: dto.logoUrl ?? null,
      },
    });
  }

  async getCompany(id: string, user: JwtUser) {
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      include: {
        threads: {
          select: {
            id: true,
            subject: true,
            contactId: true,
            companyId: true,
            updatedAt: true,
          },
        },
        contacts: { select: { id: true, email: true, fullName: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    return {
      id: company.id,
      tenantId: company.organizationId,
      name: company.name,
      primaryDomain: company.primaryDomain || company.domain || null,
      additionalDomains: this.readStringArray(company.additionalDomains),
      customFields: this.readObject(company.customFields),
      contacts: company.contacts,
      threads: company.threads,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    };
  }

  async updateCompany(id: string, dto: UpdateCompanyDto, user: JwtUser) {
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!company) throw new NotFoundException('Company not found');

    return this.prisma.company.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.primaryDomain !== undefined && {
          domain: dto.primaryDomain || null,
          primaryDomain: dto.primaryDomain || null,
        }),
        ...(dto.additionalDomains !== undefined && {
          additionalDomains: this.normalizeArray(dto.additionalDomains),
        }),
        ...(dto.customFields !== undefined && {
          customFields: this.normalizeObject(dto.customFields),
        }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl || null }),
      },
    });
  }

  async deleteCompany(id: string, user: JwtUser): Promise<void> {
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!company) throw new NotFoundException('Company not found');
    await this.prisma.company.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async autoCreateContactIfEnabled(
    senderEmail: string,
    senderName: string | undefined,
    organizationId: string,
  ): Promise<{ contactId: string | null; companyId: string | null }> {
    const enabled = this.config.get<boolean>(
      'featureFlags.enableCrmAutoCreate',
    );
    if (!enabled) return { contactId: null, companyId: null };

    const company = await this.findOrCreateCompanyByDomain(
      senderEmail,
      organizationId,
    );
    const existing = await this.prisma.contact.findFirst({
      where: { organizationId, email: senderEmail, deletedAt: null },
      select: { id: true, companyId: true },
    });

    if (existing) {
      if (!existing.companyId && company) {
        await this.prisma.contact.update({
          where: { id: existing.id },
          data: { companyId: company.id },
        });
      }
      return {
        contactId: existing.id,
        companyId: company?.id ?? existing.companyId ?? null,
      };
    }

    const created = await this.prisma.contact.create({
      data: {
        organizationId,
        email: senderEmail,
        name: senderName,
        fullName: senderName,
        source: 'email-sync',
        lifecycleStage: 'lead',
        ...(company ? { companyId: company.id } : {}),
      },
      select: { id: true, companyId: true },
    });
    return {
      contactId: created.id,
      companyId: created.companyId ?? company?.id ?? null,
    };
  }

  private mapContactList(contact: any) {
    const mapped = this.mapContactBase(contact);
    return mapped;
  }

  private mapContactBase(contact: any) {
    const emailCount = contact.threads.reduce(
      (sum: number, thread: any) => sum + thread.messages.length,
      0,
    );
    const threadCount = contact.threads.length;
    const lastContactedAt =
      [
        ...contact.threads.flatMap((thread: any) =>
          thread.messages.map((message: any) => message.createdAt),
        ),
      ].sort((a: Date, b: Date) => b.getTime() - a.getTime())[0] ??
      contact.lastContactedAt ??
      contact.updatedAt;

    return {
      id: contact.id,
      tenantId: contact.organizationId,
      email: contact.email,
      fullName: contact.fullName || contact.name || null,
      additionalEmails: this.readStringArray(contact.additionalEmails),
      lifecycleStage: contact.lifecycleStage || 'lead',
      phoneNumbers: this.readArray(contact.phoneNumbers),
      addresses: this.readArray(contact.addresses),
      socialProfiles: this.readArray(contact.socialProfiles),
      customFields: this.readObject(contact.customFields),
      assignedToUserId: contact.assignedToUserId || null,
      source: contact.source || 'manual',
      companyId: contact.companyId || null,
      emailCount,
      threadCount,
      lastContactedAt,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    };
  }

  private primaryPhoneValue(
    phoneNumbers?: Array<{ value: string; primary?: boolean }> | null,
  ) {
    if (!phoneNumbers || phoneNumbers.length === 0) return null;
    return (
      phoneNumbers.find((entry) => entry.primary)?.value ||
      phoneNumbers[0]?.value ||
      null
    );
  }

  private normalizeArray(value: unknown): Prisma.InputJsonValue {
    return Array.isArray(value) ? (value as Prisma.InputJsonValue) : [];
  }

  private normalizeObject(value: unknown): Prisma.InputJsonValue {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Prisma.InputJsonValue)
      : {};
  }

  private readArray(value: unknown) {
    return Array.isArray(value) ? value : [];
  }

  private readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
  }

  private readObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async findOrCreateCompanyByDomain(
    email: string,
    organizationId: string,
  ) {
    const domain = email.includes('@')
      ? email.split('@')[1]?.toLowerCase()
      : '';
    if (!domain) return null;

    const existing = await this.prisma.company
      .findFirst({
        where: {
          organizationId,
          deletedAt: null,
          OR: [
            { primaryDomain: domain },
            { domain },
            { additionalDomains: { array_contains: [domain] } },
          ],
        },
        select: { id: true },
      })
      .catch(async () =>
        this.prisma.company.findFirst({
          where: {
            organizationId,
            deletedAt: null,
            OR: [{ primaryDomain: domain }, { domain }],
          },
          select: { id: true },
        }),
      );
    if (existing) return existing;

    return this.prisma.company.create({
      data: {
        organizationId,
        name: this.companyNameFromDomain(domain),
        domain,
        primaryDomain: domain,
      },
      select: { id: true },
    });
  }

  private companyNameFromDomain(domain: string) {
    const root = domain.split('.')[0] || domain;
    return root.charAt(0).toUpperCase() + root.slice(1);
  }

  private async getAccessibleMailboxIds(
    user: JwtUser,
  ): Promise<string[] | null> {
    const canManageMailboxes =
      user.permissions.includes('*') ||
      user.permissions.includes('mailboxes:manage');
    if (canManageMailboxes) {
      return null;
    }

    if (!user.permissions.includes('contacts:view')) {
      throw new ForbiddenException('Access denied');
    }

    const teamMemberships = await this.prisma.teamMember.findMany({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    const teamIds = teamMemberships.map((membership) => membership.teamId);
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

    return Array.from(new Set(accesses.map((entry) => entry.mailboxId)));
  }

  private async dispatchContactActivity(params: {
    organizationId: string;
    actor: JwtUser;
    contactId: string;
    contactEmail: string;
    contactName: string;
    activity: 'created' | 'updated';
    preferredUserId?: string;
  }) {
    const recipients = new Set<string>();
    recipients.add(params.actor.sub);
    if (params.preferredUserId) {
      recipients.add(params.preferredUserId);
    }

    await Promise.all(
      [...recipients].map((recipientId) =>
        this.notifications
          .dispatch({
            userId: recipientId,
            organizationId: params.organizationId,
            type: 'contact_activity',
            title: `Contact ${params.activity}`,
            message: `${params.contactName} (${params.contactEmail}) was ${params.activity}`,
            resourceId: params.contactId,
            data: {
              contactId: params.contactId,
              activity: params.activity,
              actorUserId: params.actor.sub,
            },
          })
          .catch(() => undefined),
      ),
    );
  }
}
