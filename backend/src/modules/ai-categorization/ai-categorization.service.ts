import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { FeatureFlagsService } from '../../config/feature-flags.service';

export const AI_CATEGORIZATION_PREFIX = 'AI: ';
export const AI_CATEGORIZATION_COLOR = '#0f766e';

export const AI_CATEGORIES = [
  'billing',
  'bug_report',
  'feature_request',
  'account_access',
  'sales',
  'spam',
  'other',
] as const;

export type AiCategory = (typeof AI_CATEGORIES)[number];

export interface InboundAiCategorizationInput {
  organizationId: string;
  mailboxId: string;
  threadId: string;
  messageId: string;
  fromEmail: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  hasAttachments: boolean;
}

export class AiCategorizationCreditLimitError extends Error {
  constructor(readonly organizationId: string, readonly cost: number) {
    super(
      `AI categorization credit limit reached for organization ${organizationId}`,
    );
  }
}

type CategorizationOutcome =
  | { status: 'classified'; category: AiCategory }
  | {
      status:
        | 'skipped_flag_disabled'
        | 'skipped_no_api_key'
        | 'skipped_no_content'
        | 'skipped_already_categorized'
        | 'skipped_credit_limit'
        | 'skipped_error';
    };

function safeNumber(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function trimQuotedContent(input: string): string {
  const lines = input.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized) {
      kept.push(line);
      continue;
    }
    if (
      /^>/.test(normalized) ||
      /^On .+wrote:$/i.test(normalized) ||
      /^From:/i.test(normalized) ||
      /^Sent:/i.test(normalized) ||
      /^To:/i.test(normalized) ||
      /^Subject:/i.test(normalized) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(normalized)
    ) {
      break;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

function trimSignature(input: string): string {
  const signatureBreaks = ['\n-- \n', '\n___\n', '\nSent from'];
  for (const marker of signatureBreaks) {
    const idx = input.indexOf(marker);
    if (idx >= 0) {
      return input.slice(0, idx);
    }
  }
  return input;
}

export function extractCategorizationBody(
  bodyText: string,
  bodyHtml: string | null,
  maxChars: number,
): string {
  const source = bodyText?.trim().length
    ? bodyText
    : bodyHtml
      ? stripHtml(bodyHtml)
      : '';

  const condensed = trimSignature(trimQuotedContent(source))
    .replace(/\s+/g, ' ')
    .trim();
  if (!condensed) return '';
  return condensed.slice(0, Math.max(200, maxChars));
}

export function normalizeAiCategory(input: string): AiCategory {
  const raw = input.trim().toLowerCase();
  if (!raw) return 'other';

  const extractFromJson = (): string => {
    if (!(raw.startsWith('{') && raw.endsWith('}'))) return raw;
    try {
      const parsed = JSON.parse(raw) as { category?: string };
      return String(parsed.category ?? '').trim().toLowerCase() || raw;
    } catch {
      return raw;
    }
  };

  const value = extractFromJson().replace(/[`"'.,]/g, '');
  if ((AI_CATEGORIES as readonly string[]).includes(value)) {
    return value as AiCategory;
  }

  if (value.includes('bug')) return 'bug_report';
  if (value.includes('feature')) return 'feature_request';
  if (value.includes('account') || value.includes('login')) {
    return 'account_access';
  }
  if (value.includes('bill') || value.includes('invoice')) return 'billing';
  if (value.includes('sale') || value.includes('pricing')) return 'sales';
  if (value.includes('spam') || value.includes('phish')) return 'spam';
  return 'other';
}

function categoryToTagName(category: AiCategory): string {
  const mapping: Record<AiCategory, string> = {
    billing: 'Billing',
    bug_report: 'Bug Report',
    feature_request: 'Feature Request',
    account_access: 'Account Access',
    sales: 'Sales',
    spam: 'Spam',
    other: 'Other',
  };
  return `${AI_CATEGORIZATION_PREFIX}${mapping[category]}`;
}

@Injectable()
export class AiCategorizationService {
  private readonly logger = new Logger(AiCategorizationService.name);
  private anthropicClient: Anthropic | null = null;
  private anthropicClientKey: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  async categorizeInboundThread(
    input: InboundAiCategorizationInput,
  ): Promise<CategorizationOutcome> {
    if (!this.featureFlags.get('FEATURE_AI_CATEGORIZATION')) {
      this.logger.debug(
        `[ai-categorization] skipped feature disabled org=${input.organizationId} mailbox=${input.mailboxId} thread=${input.threadId}`,
      );
      return { status: 'skipped_flag_disabled' };
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      this.logger.warn(
        `[ai-categorization] skipped missing ANTHROPIC_API_KEY org=${input.organizationId} mailbox=${input.mailboxId}`,
      );
      return { status: 'skipped_no_api_key' };
    }

    const alreadyTagged = await this.prisma.threadTag.findFirst({
      where: {
        threadId: input.threadId,
        tag: {
          organizationId: input.organizationId,
          deletedAt: null,
          name: { startsWith: AI_CATEGORIZATION_PREFIX },
        },
      },
      select: { tagId: true },
    });
    if (alreadyTagged) {
      return { status: 'skipped_already_categorized' };
    }

    const maxBodyChars = safeNumber(
      this.configService.get<number>('aiCategorization.maxBodyChars') ?? 2500,
      2500,
    );
    const cleanedBody = extractCategorizationBody(
      input.bodyText,
      input.bodyHtml,
      maxBodyChars,
    );
    if (!input.subject?.trim() && !cleanedBody) {
      return { status: 'skipped_no_content' };
    }

    const cost = safeNumber(
      this.configService.get<number>('aiCategorization.creditDeduction') ?? 0.8,
      0.8,
    );
    const deducted = await this.tryDeductCredits(input.organizationId, cost);
    if (!deducted) {
      this.logger.warn(
        `[ai-categorization] skipped credit limit org=${input.organizationId} mailbox=${input.mailboxId} thread=${input.threadId} cost=${cost}`,
      );
      return { status: 'skipped_credit_limit' };
    }

    const startedAt = Date.now();
    try {
      const category = await this.requestCategoryFromClaude({
        ...input,
        bodyText: cleanedBody,
      });
      await this.persistCategoryTag(
        input.organizationId,
        input.threadId,
        category,
      );
      this.logger.log(
        `[ai-categorization] classified org=${input.organizationId} mailbox=${input.mailboxId} thread=${input.threadId} message=${input.messageId} category=${category} latencyMs=${Date.now() - startedAt}`,
      );
      return { status: 'classified', category };
    } catch (error) {
      this.logger.warn(
        `[ai-categorization] failed org=${input.organizationId} mailbox=${input.mailboxId} thread=${input.threadId} message=${input.messageId} latencyMs=${Date.now() - startedAt} error=${String(error)}`,
      );
      return { status: 'skipped_error' };
    }
  }

  async assertCreditsForApiOrThrow(organizationId: string): Promise<void> {
    const cost = safeNumber(
      this.configService.get<number>('aiCategorization.creditDeduction') ?? 0.8,
      0.8,
    );
    const hasCredits = await this.hasEnoughCredits(organizationId, cost);
    if (!hasCredits) {
      throw new HttpException(
        'AI categorization credit limit reached for organization',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async reserveCreditsOrThrow(organizationId: string): Promise<void> {
    const cost = safeNumber(
      this.configService.get<number>('aiCategorization.creditDeduction') ?? 0.8,
      0.8,
    );
    const deducted = await this.tryDeductCredits(organizationId, cost);
    if (!deducted) {
      throw new AiCategorizationCreditLimitError(organizationId, cost);
    }
  }

  private async hasEnoughCredits(
    organizationId: string,
    requiredCredits: number,
  ): Promise<boolean> {
    const prismaAny = this.prisma as any;
    const org = (await prismaAny.organization.findUnique({
      where: { id: organizationId },
      select: { aiCategorizationCredits: true },
    })) as { aiCategorizationCredits?: number | string } | null;
    if (!org) return false;
    return Number(org.aiCategorizationCredits) >= requiredCredits;
  }

  private async tryDeductCredits(
    organizationId: string,
    cost: number,
  ): Promise<boolean> {
    const roundedCost = Math.round(cost * 100) / 100;
    const prismaAny = this.prisma as any;
    const updated = (await prismaAny.organization.updateMany({
      where: {
        id: organizationId,
        aiCategorizationCredits: { gte: roundedCost },
      },
      data: {
        aiCategorizationCredits: {
          decrement: roundedCost,
        },
      },
    })) as { count: number };
    return updated?.count > 0;
  }

  private getAnthropicClient(): Anthropic {
    const key = process.env.ANTHROPIC_API_KEY ?? '';
    if (!key) {
      throw new Error('ANTHROPIC_API_KEY is missing');
    }
    if (!this.anthropicClient || this.anthropicClientKey !== key) {
      this.anthropicClient = new Anthropic({ apiKey: key });
      this.anthropicClientKey = key;
    }
    return this.anthropicClient;
  }

  private async requestCategoryFromClaude(
    input: Omit<InboundAiCategorizationInput, 'bodyHtml'> & { bodyText: string },
  ): Promise<AiCategory> {
    const model =
      this.configService.get<string>('aiCategorization.model') ??
      'claude-haiku-4-5-20251001';
    const timeoutMs = safeNumber(
      this.configService.get<number>('aiCategorization.timeoutMs') ?? 4000,
      4000,
    );

    const toSample = input.toAddresses.slice(0, 8).join(', ');
    const ccSample = input.ccAddresses.slice(0, 8).join(', ');
    const fromDomain = input.fromEmail.includes('@')
      ? input.fromEmail.split('@')[1]
      : '';

    const content = [
      `Subject: ${input.subject || '(no subject)'}`,
      `From: ${input.fromEmail}`,
      fromDomain ? `From-Domain: ${fromDomain}` : '',
      toSample ? `To: ${toSample}` : '',
      ccSample ? `Cc: ${ccSample}` : '',
      `Has-Attachments: ${input.hasAttachments ? 'true' : 'false'}`,
      `Body: ${input.bodyText || '(empty)'}`,
    ]
      .filter(Boolean)
      .join('\n');

    const client = this.getAnthropicClient();
    const prompt =
      'Classify the email into exactly one category token from: ' +
      AI_CATEGORIES.join(', ') +
      '. Return only the category token.';

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`AI categorization timed out (${timeoutMs}ms)`)),
        timeoutMs,
      );
    });
    const response = (await Promise.race([
      client.messages.create({
        model,
        max_tokens: 16,
        temperature: 0,
        system: prompt,
        messages: [{ role: 'user', content }],
      }),
      timeout,
    ])) as Anthropic.Message;

    const rawText = response.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join(' ')
      .trim();
    return normalizeAiCategory(rawText);
  }

  private async persistCategoryTag(
    organizationId: string,
    threadId: string,
    category: AiCategory,
  ): Promise<void> {
    const tagName = categoryToTagName(category);
    const existingTag = await this.prisma.tag.findFirst({
      where: { organizationId, name: tagName, deletedAt: null },
      select: { id: true },
    });
    const tagId =
      existingTag?.id ??
      (
        await this.prisma.tag.create({
          data: {
            organizationId,
            name: tagName,
            color: AI_CATEGORIZATION_COLOR,
            scope: 'organization',
          },
          select: { id: true },
        })
      ).id;

    await this.prisma.threadTag.upsert({
      where: {
        threadId_tagId: {
          threadId,
          tagId,
        },
      },
      update: {},
      create: { threadId, tagId },
    });
  }
}
