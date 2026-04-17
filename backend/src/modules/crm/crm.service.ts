import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type {
  CreateContactDto,
  UpdateContactDto,
  CreateCompanyDto,
  UpdateCompanyDto,
  UpdateContactNotificationPreferenceDto,
} from './dto/crm.dto';
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

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

    await this.emitContactActivity({
      organizationId: user.organizationId,
      contactId: created.id,
      activity: 'created',
      actorUserId: user.sub,
      preferredUserId: created.assignedToUserId ?? undefined,
      recipientUserIds: [user.sub, created.assignedToUserId ?? undefined].filter(
        (recipientId): recipientId is string => Boolean(recipientId),
      ),
      contact: {
        id: created.id,
        email: created.email,
        name: created.name,
        fullName: created.fullName,
      },
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

    await this.emitContactActivity({
      organizationId: user.organizationId,
      contactId: updated.id,
      activity: 'updated',
      actorUserId: user.sub,
      preferredUserId: updated.assignedToUserId ?? undefined,
      recipientUserIds: [user.sub, updated.assignedToUserId ?? undefined].filter(
        (recipientId): recipientId is string => Boolean(recipientId),
      ),
      contact: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        fullName: updated.fullName,
      },
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

  async getContactNotificationPreference(contactId: string, user: JwtUser) {
    const contact = await this.prisma.contact.findFirst({
      where: {
        id: contactId,
        organizationId: user.organizationId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const [contactPref, typePref] = await Promise.all([
      this.prisma.contactNotificationPreference.findUnique({
        where: {
          userId_contactId_notificationType: {
            userId: user.sub,
            contactId,
            notificationType: 'contact_activity',
          },
        },
      }),
      this.prisma.notificationPreference.findUnique({
        where: {
          userId_notificationType: {
            userId: user.sub,
            notificationType: 'contact_activity',
          },
        },
        select: {
          enabled: true,
          inApp: true,
          email: true,
          push: true,
          desktop: true,
        },
      }),
    ]);

    return {
      contactId,
      notificationType: 'contact_activity',
      hasOverride: Boolean(contactPref),
      enabled: contactPref?.enabled ?? typePref?.enabled ?? true,
      channels: {
        in_app: contactPref?.inApp ?? typePref?.inApp ?? true,
        email: contactPref?.email ?? typePref?.email ?? true,
        push: contactPref?.push ?? typePref?.push ?? false,
        desktop: contactPref?.desktop ?? typePref?.desktop ?? false,
      },
    };
  }

  async updateContactNotificationPreference(
    contactId: string,
    dto: UpdateContactNotificationPreferenceDto,
    user: JwtUser,
  ) {
    const contact = await this.prisma.contact.findFirst({
      where: {
        id: contactId,
        organizationId: user.organizationId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const [existing, fallback] = await Promise.all([
      this.prisma.contactNotificationPreference.findUnique({
        where: {
          userId_contactId_notificationType: {
            userId: user.sub,
            contactId,
            notificationType: 'contact_activity',
          },
        },
      }),
      this.prisma.notificationPreference.findUnique({
        where: {
          userId_notificationType: {
            userId: user.sub,
            notificationType: 'contact_activity',
          },
        },
        select: {
          enabled: true,
          inApp: true,
          email: true,
          push: true,
          desktop: true,
        },
      }),
    ]);

    const nextEnabled =
      dto.enabled ?? existing?.enabled ?? fallback?.enabled ?? true;
    const nextInApp =
      dto.inApp ?? dto.in_app ?? existing?.inApp ?? fallback?.inApp ?? true;
    const nextEmail = dto.email ?? existing?.email ?? fallback?.email ?? true;
    const nextPush = dto.push ?? existing?.push ?? fallback?.push ?? false;
    const nextDesktop =
      dto.desktop ?? existing?.desktop ?? fallback?.desktop ?? false;

    const saved = await this.prisma.contactNotificationPreference.upsert({
      where: {
        userId_contactId_notificationType: {
          userId: user.sub,
          contactId,
          notificationType: 'contact_activity',
        },
      },
      create: {
        userId: user.sub,
        organizationId: user.organizationId,
        contactId,
        notificationType: 'contact_activity',
        enabled: nextEnabled,
        inApp: nextInApp,
        email: nextEmail,
        push: nextPush,
        desktop: nextDesktop,
      },
      update: {
        enabled: nextEnabled,
        inApp: nextInApp,
        email: nextEmail,
        push: nextPush,
        desktop: nextDesktop,
      },
    });

    return {
      contactId,
      notificationType: 'contact_activity',
      hasOverride: true,
      enabled: saved.enabled,
      channels: {
        in_app: saved.inApp,
        email: saved.email,
        push: saved.push,
        desktop: saved.desktop,
      },
    };
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

  async emitContactActivity(params: {
    organizationId: string;
    contactId: string;
    activity:
      | 'created'
      | 'updated'
      | 'email_received'
      | 'email_sent'
      | 'thread_updated';
    actorUserId?: string;
    threadId?: string;
    mailboxId?: string;
    messageId?: string;
    preferredUserId?: string;
    recipientUserIds?: string[];
    contact?: {
      id: string;
      email: string;
      name: string | null;
      fullName: string | null;
    };
  }) {
    const contact =
      params.contact ??
      (await this.prisma.contact.findFirst({
        where: {
          id: params.contactId,
          organizationId: params.organizationId,
          deletedAt: null,
        },
        select: {
          id: true,
          email: true,
          name: true,
          fullName: true,
        },
      }));
    if (!contact) {
      return;
    }

    const noisyActivities = ['email_received', 'email_sent', 'thread_updated'];
    const recipients = new Set<string>(params.recipientUserIds ?? []);
    if (recipients.size === 0 && !noisyActivities.includes(params.activity)) {
      const users = await this.prisma.user.findMany({
        where: {
          organizationId: params.organizationId,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
      users.forEach((entry) => recipients.add(entry.id));
    }
    if (params.actorUserId) {
      recipients.add(params.actorUserId);
    }
    if (params.preferredUserId) {
      recipients.add(params.preferredUserId);
    }

    const label = this.contactActivityLabel(params.activity);
    const contactName = contact.fullName || contact.name || contact.email;

    await Promise.all(
      [...recipients].map((recipientId) =>
        this.notifications
          .dispatch({
            userId: recipientId,
            organizationId: params.organizationId,
            type: 'contact_activity',
            title: `Contact ${label.title}`,
            message: `${contactName} (${contact.email}) ${label.messageSuffix}`,
            resourceId: contact.id,
            data: {
              contactId: contact.id,
              activity: params.activity,
              actorUserId: params.actorUserId ?? null,
              threadId: params.threadId ?? null,
              mailboxId: params.mailboxId ?? null,
              messageId: params.messageId ?? null,
            },
          })
          .catch((error) => {
            this.logger.warn(
              `[crm] Failed to dispatch contact_activity contact=${contact.id} recipient=${recipientId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }),
      ),
    );
  }

  private contactActivityLabel(activity: string): {
    title: string;
    messageSuffix: string;
  } {
    switch (activity) {
      case 'created':
        return { title: 'created', messageSuffix: 'was created' };
      case 'updated':
        return { title: 'updated', messageSuffix: 'was updated' };
      case 'email_received':
        return { title: 'email received', messageSuffix: 'sent a new email' };
      case 'email_sent':
        return { title: 'email sent', messageSuffix: 'received an email reply' };
      case 'thread_updated':
        return {
          title: 'thread updated',
          messageSuffix: 'has an updated thread activity',
        };
      default:
        return {
          title: 'activity updated',
          messageSuffix: 'has new activity',
        };
    }
  }
}
