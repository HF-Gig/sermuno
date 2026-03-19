import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { MessagesService } from '../messages/messages.service';

@Injectable()
export class ScheduledMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messagesService: MessagesService,
  ) {}

  async create(
    body: {
      mailboxId: string;
      threadId?: string;
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject?: string;
      bodyHtml?: string;
      bodyText?: string;
      scheduledAt: string;
      rrule?: string;
      timezone?: string;
    },
    user: JwtUser,
  ) {
    if (!body?.mailboxId) {
      throw new BadRequestException('mailboxId is required');
    }

    if (!Array.isArray(body?.to) || body.to.length === 0) {
      throw new BadRequestException('to is required');
    }

    if (!body?.scheduledAt) {
      throw new BadRequestException('scheduledAt is required');
    }

    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('scheduledAt must be a valid ISO datetime');
    }

    const message = await this.messagesService.send(
      {
        mailboxId: body.mailboxId,
        threadId: body.threadId,
        to: body.to,
        cc: body.cc ?? [],
        bcc: body.bcc ?? [],
        subject: body.subject,
        bodyHtml: body.bodyHtml,
        bodyText: body.bodyText,
        scheduledAt,
        rrule: body.rrule,
        timezone: body.timezone ?? 'UTC',
      },
      user,
    );

    const scheduled = await this.prisma.scheduledMessage.findFirst({
      where: {
        organizationId: user.organizationId,
        status: 'pending',
        payload: { path: ['id'], equals: message.id },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      scheduledMessageId: scheduled?.id ?? null,
      messageId: message.id,
      threadId: message.threadId,
      mailboxId: message.mailboxId,
      scheduledAt: scheduled?.scheduledAt ?? scheduledAt,
      status: scheduled?.status ?? 'pending',
    };
  }

  async findOne(id: string, user: JwtUser) {
    const row = await this.prisma.scheduledMessage.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!row) throw new NotFoundException('Scheduled message not found');
    return row;
  }

  async cancel(id: string, user: JwtUser) {
    const row = await this.findOne(id, user);
    if (row.status !== 'pending') {
      throw new BadRequestException(
        'Only pending scheduled messages can be cancelled',
      );
    }
    return this.prisma.scheduledMessage.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
  }

  async patchStatus(id: string, status: string, user: JwtUser) {
    if (status !== 'cancelled') {
      throw new BadRequestException('Only status=cancelled is supported');
    }
    return this.cancel(id, user);
  }
}
