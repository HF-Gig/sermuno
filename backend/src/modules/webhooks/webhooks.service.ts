import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';

/** Valid outgoing event types */
export const WEBHOOK_EVENT_TYPES = [
  'thread.created',
  'thread.assigned',
  'thread.updated',
  'thread.closed',
  'message.received',
  'message.sent',
  'message.updated',
  'contact.created',
  'contact.updated',
  'sla.warning',
  'sla.breach',
  'rule.triggered',
  'calendar_event.created',
  'calendar_event.updated',
  'calendar_event.deleted',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD
  // ─────────────────────────────────────────────────────────────────────────

  async list(user: JwtUser) {
    return this.prisma.webhook.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateWebhookDto, user: JwtUser) {
    const secret = dto.secret ?? crypto.randomBytes(32).toString('hex');
    return this.prisma.webhook.create({
      data: {
        organizationId: user.organizationId,
        url: dto.url,
        events: (dto.events ?? []) as Prisma.InputJsonValue,
        secret,
        headers: (dto.headers ?? {}) as Prisma.InputJsonValue,
        filterMailboxIds: (dto.filterMailboxIds ?? []) as Prisma.InputJsonValue,
        filterTeamIds: (dto.filterTeamIds ?? []) as Prisma.InputJsonValue,
        filterTagIds: (dto.filterTagIds ?? []) as Prisma.InputJsonValue,
      },
    });
  }

  async findOne(id: string, user: JwtUser) {
    const wh = await this.prisma.webhook.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!wh) throw new NotFoundException('Webhook not found');
    return wh;
  }

  async update(id: string, dto: UpdateWebhookDto, user: JwtUser) {
    const wh = await this.prisma.webhook.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!wh) throw new NotFoundException('Webhook not found');

    return this.prisma.webhook.update({
      where: { id },
      data: {
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.events !== undefined && {
          events: dto.events as Prisma.InputJsonValue,
        }),
        ...(dto.secret !== undefined && { secret: dto.secret }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.headers !== undefined && {
          headers: dto.headers as Prisma.InputJsonValue,
        }),
        ...(dto.filterMailboxIds !== undefined && {
          filterMailboxIds: dto.filterMailboxIds as Prisma.InputJsonValue,
        }),
        ...(dto.filterTeamIds !== undefined && {
          filterTeamIds: dto.filterTeamIds as Prisma.InputJsonValue,
        }),
        ...(dto.filterTagIds !== undefined && {
          filterTagIds: dto.filterTagIds as Prisma.InputJsonValue,
        }),
      },
    });
  }

  async remove(id: string, user: JwtUser): Promise<void> {
    const wh = await this.prisma.webhook.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!wh) throw new NotFoundException('Webhook not found');
    // Soft delete
    await this.prisma.webhook.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Incoming webhook handler
  // ─────────────────────────────────────────────────────────────────────────

  async handleIncoming(
    organizationId: string,
    rawBody: string,
    signature: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<{ received: boolean }> {
    // Find active webhook endpoint for this org configured to receive incoming events
    const wh = await this.prisma.webhook.findFirst({
      where: { organizationId, isActive: true, deletedAt: null },
    });

    // Verify HMAC signature if the webhook has a secret configured
    if (wh?.secret && signature) {
      const expected = `sha256=${crypto.createHmac('sha256', wh.secret).update(rawBody).digest('hex')}`;
      if (signature !== expected) {
        this.logger.warn(
          `[webhooks] Incoming signature mismatch for org=${organizationId}`,
        );
        return { received: false };
      }
    }

    this.logger.log(
      `[webhooks] Incoming payload for org=${organizationId}: ${JSON.stringify(payload).slice(0, 200)}`,
    );
    return { received: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Outgoing dispatch
  // ─────────────────────────────────────────────────────────────────────────

  async dispatch(
    organizationId: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const enabled = this.config.get<boolean>('featureFlags.enableWebhooks');
    if (!enabled) return;

    const mailboxId =
      typeof payload.mailboxId === 'string' ? payload.mailboxId : null;
    if (mailboxId) {
      const mailbox = await this.prisma.mailbox.findFirst({
        where: { id: mailboxId, organizationId, deletedAt: null },
        select: { syncStatus: true, lastSyncError: true },
      });

      if (
        mailbox?.syncStatus === 'FAILED' &&
        mailbox?.lastSyncError === 'OAuth disconnected'
      ) {
        return;
      }
    }

    const hooks = await this.prisma.webhook.findMany({
      where: { organizationId, isActive: true, deletedAt: null },
    });

    for (const hook of hooks) {
      const events = hook.events as string[];
      if (!events.includes(eventType)) continue;

      await this.deliverWithRetry(hook, eventType, payload);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Delivery with retry (3 attempts, exponential backoff)
  // ─────────────────────────────────────────────────────────────────────────

  private async deliverWithRetry(
    hook: {
      id: string;
      url: string;
      secret: string;
      consecutiveFailures: number;
      maxRetries: number;
      retryDelaySeconds?: number | null;
      headers?: Prisma.JsonValue | null;
    },
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const body = JSON.stringify({
      event: eventType,
      data: payload,
      timestamp: new Date().toISOString(),
    });
    const sig = `sha256=${crypto.createHmac('sha256', hook.secret).update(body).digest('hex')}`;

    const maxAttempts = Math.max(1, Number(hook.maxRetries || 3));
    const retryDelayMs = Math.max(1, Number(hook.retryDelaySeconds || 60)) * 1000;
    let attempt = 0;
    let delivered = false;

    while (attempt < maxAttempts && !delivered) {
      if (attempt > 0) {
        await this.sleep(retryDelayMs);
      }
      attempt++;
      try {
        const statusCode = await this.postWebhook(
          hook.url,
          body,
          sig,
          hook.headers,
        );
        if (statusCode >= 200 && statusCode < 300) {
          delivered = true;
          // Reset failure counter on success
          await this.prisma.webhook.update({
            where: { id: hook.id },
            data: { consecutiveFailures: 0, lastTriggeredAt: new Date() },
          });
        } else {
          this.logger.warn(
            `[webhooks] Delivery attempt ${attempt} for hook=${hook.id} returned ${statusCode}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `[webhooks] Delivery attempt ${attempt} for hook=${hook.id} error: ${String(err)}`,
        );
      }
    }

    if (!delivered) {
      const newFailures = hook.consecutiveFailures + 1;
      const shouldDisable = newFailures >= 3;
      await this.prisma.webhook.update({
        where: { id: hook.id },
        data: {
          consecutiveFailures: newFailures,
          lastFailedAt: new Date(),
          ...(shouldDisable && { isActive: false }),
        },
      });
      if (shouldDisable) {
        this.logger.warn(
          `[webhooks] Auto-disabled hook=${hook.id} after 3 consecutive failures`,
        );
      }
    }
  }

  private postWebhook(
    url: string,
    body: string,
    signature: string,
    customHeaders?: Prisma.JsonValue | null,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const transport = parsed.protocol === 'http:' ? http : https;
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...this.normalizeHeaders(customHeaders),
          'X-Webhook-Signature': signature,
          'X-sermuno-Signature': signature,
        },
      };

      const req = transport.request(options, (res) =>
        resolve(res.statusCode ?? 0),
      );
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy(new Error('Webhook delivery timeout'));
      });
      req.write(body);
      req.end();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizeHeaders(headersValue?: Prisma.JsonValue | null) {
    if (
      !headersValue ||
      typeof headersValue !== 'object' ||
      Array.isArray(headersValue)
    ) {
      return {};
    }

    return Object.entries(headersValue as Record<string, unknown>).reduce(
      (acc, [key, value]) => {
        if (!key) return acc;
        acc[key] = String(value);
        return acc;
      },
      {} as Record<string, string>,
    );
  }
}
