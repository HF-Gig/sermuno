import {
  Injectable,
  BadRequestException,
  NotFoundException,
  RawBodyRequest,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateCheckoutDto,
  CreatePortalDto,
  UpdateBillingDetailsDto,
  ChangeSubscriptionDto,
} from './dto/billing.dto';
import Stripe from 'stripe';
import { Request } from 'express';
import { PlanTier, SubscriptionStatus } from '@prisma/client';

@Injectable()
export class BillingService {
  private stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.stripe = new Stripe(
      this.config.get<string>('stripe.secretKey') ?? '',
      {
        apiVersion: '2026-02-25.clover',
      },
    );
  }

  // ─── Get billing info ──────────────────────────────────────────────────────

  async getInfo(organizationId: string): Promise<object> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const [usersUsed, mailboxesUsed, storageAgg] = await Promise.all([
      this.prisma.user.count({ where: { organizationId, deletedAt: null } }),
      this.prisma.mailbox.count({ where: { organizationId, deletedAt: null } }),
      this.prisma.attachment.aggregate({
        _sum: { sizeBytes: true },
        where: { message: { mailbox: { organizationId } } },
      }),
    ]);

    const storageUsedBytes = storageAgg._sum.sizeBytes ?? 0;
    const storageUsedGb = Number(
      (storageUsedBytes / (1024 * 1024 * 1024)).toFixed(2),
    );

    let subscription: Stripe.Subscription | null = null;
    if (org.stripeSubscriptionId) {
      try {
        subscription = await this.stripe.subscriptions.retrieve(
          org.stripeSubscriptionId,
          {
            expand: ['default_payment_method', 'items.data.price'],
          },
        );
      } catch {
        // ignore — subscription may have been deleted
      }
    }

    const customer = await this.getStripeCustomer(org.stripeCustomerId);
    const paymentMethod = await this.resolvePaymentMethod(
      customer,
      subscription,
    );
    const invoices = await this.listInvoices(org.stripeCustomerId);
    const taxNumber = await this.getTaxNumber(org.stripeCustomerId);

    const item = subscription?.items.data[0];
    const recurringInterval = item?.price?.recurring?.interval;
    const billingCycle =
      recurringInterval === 'year'
        ? 'yearly'
        : recurringInterval === 'month'
          ? 'monthly'
          : null;
    const rawPeriodEnd = (
      subscription as unknown as { current_period_end?: number } | null
    )?.current_period_end;
    const rawTrialEnd = (
      subscription as unknown as { trial_end?: number | null } | null
    )?.trial_end;
    const pricePerCycle =
      item?.price?.unit_amount !== null &&
      item?.price?.unit_amount !== undefined
        ? Number((item.price.unit_amount / 100).toFixed(2))
        : null;

    return {
      currentPlan: org.plan,
      plan: org.plan,
      subscriptionStatus: org.subscriptionStatus,
      stripeCustomerId: org.stripeCustomerId,
      stripeSubscriptionId: org.stripeSubscriptionId,
      maxMailboxes: org.maxMailboxes,
      maxUsers: org.maxUsers,
      maxStorageGb: org.maxStorageGb,
      limits: {
        maxUsers: org.maxUsers,
        maxMailboxes: org.maxMailboxes,
        maxStorageGb: org.maxStorageGb,
      },
      usage: {
        usersUsed,
        usersTotal: org.maxUsers,
        mailboxesUsed,
        mailboxesTotal: org.maxMailboxes,
        storageUsedGb,
        storageTotalGb: org.maxStorageGb,
      },
      subscriptionDetails: {
        planName: org.plan,
        billingCycle,
        nextBillingDate: rawPeriodEnd ? new Date(rawPeriodEnd * 1000) : null,
        trialEndDate: rawTrialEnd ? new Date(rawTrialEnd * 1000) : null,
        pricePerCycle,
        currency: item?.price?.currency ?? null,
        autoRenew: subscription
          ? !(subscription as unknown as { cancel_at_period_end: boolean })
              .cancel_at_period_end
          : null,
      },
      paymentMethod,
      invoices,
      billingInfo: {
        companyName: org.name,
        billingEmail: customer?.email ?? null,
        billingAddress: customer?.address
          ? {
              line1: customer.address.line1 ?? null,
              line2: customer.address.line2 ?? null,
              city: customer.address.city ?? null,
              state: customer.address.state ?? null,
              postalCode: customer.address.postal_code ?? null,
              country: customer.address.country ?? null,
            }
          : null,
        taxNumber,
      },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            currentPeriodEnd: new Date(
              (subscription as unknown as { current_period_end: number })
                .current_period_end * 1000,
            ),
            cancelAtPeriodEnd: (
              subscription as unknown as { cancel_at_period_end: boolean }
            ).cancel_at_period_end,
          }
        : null,
    };
  }

  // ─── Create checkout session ──────────────────────────────────────────────

  async createCheckout(
    organizationId: string,
    dto: CreateCheckoutDto,
  ): Promise<{ url: string }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const resolvedPriceId = this.resolveCheckoutPriceId(dto);

    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        name: org.name,
        metadata: { organizationId },
      });
      customerId = customer.id;
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { stripeCustomerId: customerId },
      });
    }

    const frontendUrl =
      this.config.get<string>('frontend.url') ?? 'http://localhost:5173';
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      success_url:
        dto.successUrl ??
        `${frontendUrl}/settings/organization?tab=billing&success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:
        dto.cancelUrl ??
        `${frontendUrl}/settings/organization?tab=billing&canceled=true`,
      metadata: {
        organizationId,
        planType: (dto.planType ?? '').toLowerCase(),
        cycle: dto.cycle ?? 'monthly',
      },
    });

    if (!session.url)
      throw new BadRequestException('Failed to create checkout session');
    return { url: session.url };
  }

  // ─── Create billing portal ─────────────────────────────────────────────────

  async createPortal(
    organizationId: string,
    dto: CreatePortalDto,
  ): Promise<{ url: string }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.stripeCustomerId)
      throw new BadRequestException(
        'No Stripe customer found for this organization',
      );

    const frontendUrl =
      this.config.get<string>('frontend.url') ?? 'http://localhost:5173';
    const session = await this.stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: dto.returnUrl ?? `${frontendUrl}/billing/manage`,
    });

    return { url: session.url };
  }

  async updateBillingDetails(
    organizationId: string,
    dto: UpdateBillingDetailsDto,
  ): Promise<object> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        metadata: { organizationId },
      });
      customerId = customer.id;
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { stripeCustomerId: customerId },
      });
    }

    const updatedCustomer = await this.stripe.customers.update(customerId, {
      ...(dto.companyName !== undefined && { name: dto.companyName }),
      ...(dto.billingEmail !== undefined && { email: dto.billingEmail }),
      ...(dto.address !== undefined
        ? {
            address: {
              ...(dto.address.line1 !== undefined && {
                line1: dto.address.line1,
              }),
              ...(dto.address.line2 !== undefined && {
                line2: dto.address.line2,
              }),
              ...(dto.address.city !== undefined && { city: dto.address.city }),
              ...(dto.address.state !== undefined && {
                state: dto.address.state,
              }),
              ...(dto.address.postalCode !== undefined && {
                postal_code: dto.address.postalCode,
              }),
              ...(dto.address.country !== undefined && {
                country: dto.address.country,
              }),
            },
          }
        : {}),
      ...(dto.taxNumber !== undefined
        ? { metadata: { taxNumber: dto.taxNumber } }
        : {}),
    });

    if (dto.companyName !== undefined) {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { name: dto.companyName },
      });
    }

    return {
      companyName: updatedCustomer.name,
      billingEmail: updatedCustomer.email,
      billingAddress: updatedCustomer.address
        ? {
            line1: updatedCustomer.address.line1 ?? null,
            line2: updatedCustomer.address.line2 ?? null,
            city: updatedCustomer.address.city ?? null,
            state: updatedCustomer.address.state ?? null,
            postalCode: updatedCustomer.address.postal_code ?? null,
            country: updatedCustomer.address.country ?? null,
          }
        : null,
      taxNumber: updatedCustomer.metadata?.taxNumber ?? null,
    };
  }

  async cancelSubscription(organizationId: string): Promise<object> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.stripeSubscriptionId) {
      throw new BadRequestException('No active Stripe subscription found');
    }

    const subscription = await this.stripe.subscriptions.update(
      org.stripeSubscriptionId,
      {
        cancel_at_period_end: true,
      },
    );

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      autoRenew: false,
      cancelAt: (subscription as unknown as { cancel_at?: number | null })
        .cancel_at
        ? new Date(
            (subscription as unknown as { cancel_at: number }).cancel_at * 1000,
          )
        : null,
    };
  }

  async resumeSubscription(organizationId: string): Promise<object> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.stripeSubscriptionId) {
      throw new BadRequestException('No Stripe subscription found');
    }

    const subscription = await this.stripe.subscriptions.update(
      org.stripeSubscriptionId,
      {
        cancel_at_period_end: false,
      },
    );

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      autoRenew: true,
    };
  }

  async changeSubscription(
    organizationId: string,
    dto: ChangeSubscriptionDto,
  ): Promise<object> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.stripeSubscriptionId) {
      throw new BadRequestException('No Stripe subscription found');
    }

    const subscription = await this.stripe.subscriptions.retrieve(
      org.stripeSubscriptionId,
    );
    const currentItem = subscription.items.data[0];
    if (!currentItem) {
      throw new BadRequestException('Subscription has no price items');
    }

    const nextPriceId = this.resolvePriceIdForPlanCycle(
      dto.planType,
      dto.cycle,
    );
    const updated = await this.stripe.subscriptions.update(
      org.stripeSubscriptionId,
      {
        cancel_at_period_end: false,
        items: [{ id: currentItem.id, price: nextPriceId }],
        proration_behavior: 'create_prorations',
      },
    );

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        plan: dto.planType === 'professional' ? 'professional' : 'starter',
      },
    });

    return {
      subscriptionId: updated.id,
      status: updated.status,
      plan: dto.planType,
      cycle: dto.cycle,
    };
  }

  async createPaymentMethodPortal(
    organizationId: string,
    returnUrl?: string,
  ): Promise<{ url: string }> {
    return this.createPortal(organizationId, { returnUrl });
  }

  async syncCheckout(
    organizationId: string,
    sessionId: string,
  ): Promise<object> {
    if (!sessionId?.trim()) {
      throw new BadRequestException('sessionId is required');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const session = await this.stripe.checkout.sessions.retrieve(
      sessionId.trim(),
      {
        expand: ['subscription', 'line_items.data.price'],
      },
    );

    const metadataOrgId = (session.metadata as Record<string, string> | null)
      ?.organizationId;
    if (metadataOrgId && metadataOrgId !== organizationId) {
      throw new ForbiddenException(
        'Checkout session does not belong to your organization',
      );
    }

    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;

    if (!subscriptionId) {
      throw new BadRequestException('Checkout session is missing subscription');
    }

    const subscription =
      typeof session.subscription === 'string'
        ? await this.stripe.subscriptions.retrieve(subscriptionId)
        : session.subscription;
    if (!subscription) {
      throw new BadRequestException(
        'Checkout session subscription is unavailable',
      );
    }

    const priceId =
      (subscription.items.data[0]?.price as Stripe.Price | undefined)?.id ??
      session.line_items?.data[0]?.price?.id ??
      '';
    const plan = this.mapPlanFromPriceId(priceId) as PlanTier;
    const status = this.mapSubscriptionStatus(
      subscription.status,
    ) as SubscriptionStatus;
    const limits = this.getPlanLimits(
      plan,
      org.maxUsers,
      org.maxMailboxes,
      org.maxStorageGb,
    );

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(customerId ? { stripeCustomerId: customerId } : {}),
        stripeSubscriptionId: subscription.id,
        plan,
        subscriptionStatus: status,
        ...limits,
      },
      select: {
        id: true,
        plan: true,
        subscriptionStatus: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        maxUsers: true,
        maxMailboxes: true,
        maxStorageGb: true,
      },
    });

    return { organization: updated };
  }

  async getInvoiceDetails(
    organizationId: string,
    invoiceId: string,
  ): Promise<object> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.stripeCustomerId)
      throw new BadRequestException(
        'No Stripe customer found for this organization',
      );

    const invoice = await this.stripe.invoices.retrieve(invoiceId);
    if (invoice.customer !== org.stripeCustomerId) {
      throw new ForbiddenException(
        'Invoice does not belong to your organization',
      );
    }

    return {
      id: invoice.id,
      date: new Date(invoice.created * 1000),
      amount: Number(
        ((invoice.amount_paid || invoice.amount_due || 0) / 100).toFixed(2),
      ),
      currency: invoice.currency,
      status: invoice.status,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      invoicePdf: invoice.invoice_pdf,
      customerEmail: invoice.customer_email,
      periodStart: invoice.period_start
        ? new Date(invoice.period_start * 1000)
        : null,
      periodEnd: invoice.period_end
        ? new Date(invoice.period_end * 1000)
        : null,
    };
  }

  // ─── Webhook handler ──────────────────────────────────────────────────────

  async handleWebhook(req: RawBodyRequest<Request>): Promise<void> {
    const webhookSecret = this.config.get<string>('stripe.webhookSecret') ?? '';
    const sig = req.headers['stripe-signature'];
    if (!sig) throw new BadRequestException('Missing stripe-signature header');

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        req.rawBody!,
        sig,
        webhookSecret,
      );
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const orgId = (sub.metadata as Record<string, string>)[
          'organizationId'
        ];
        if (orgId) {
          const plan = this.mapPlanFromPriceId(
            sub.items.data[0]?.price?.id ?? '',
          );
          await this.prisma.organization.update({
            where: { id: orgId },
            data: {
              stripeSubscriptionId: sub.id,
              plan: plan as PlanTier,
              subscriptionStatus: this.mapSubscriptionStatus(
                sub.status,
              ) as SubscriptionStatus,
            },
          });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const orgId = (sub.metadata as Record<string, string>)[
          'organizationId'
        ];
        if (orgId) {
          await this.prisma.organization.update({
            where: { id: orgId },
            data: { subscriptionStatus: 'canceled' as SubscriptionStatus },
          });
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId =
          typeof invoice.customer === 'string'
            ? invoice.customer
            : invoice.customer?.id;
        if (customerId) {
          await this.prisma.organization.updateMany({
            where: { stripeCustomerId: customerId },
            data: { subscriptionStatus: 'active' as SubscriptionStatus },
          });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId =
          typeof invoice.customer === 'string'
            ? invoice.customer
            : invoice.customer?.id;
        if (customerId) {
          await this.prisma.organization.updateMany({
            where: { stripeCustomerId: customerId },
            data: { subscriptionStatus: 'past_due' as SubscriptionStatus },
          });
        }
        break;
      }
      default:
        break;
    }
  }

  private mapPlanFromPriceId(priceId: string): string {
    const proPriceId = this.config.get<string>('stripe.proPriceId');
    const starterPriceId = this.config.get<string>('stripe.starterPriceId');
    const proYearlyPriceId = this.config.get<string>('stripe.proYearlyPriceId');
    const starterYearlyPriceId = this.config.get<string>(
      'stripe.starterYearlyPriceId',
    );
    if (priceId === proPriceId || priceId === proYearlyPriceId)
      return 'professional';
    if (priceId === starterPriceId || priceId === starterYearlyPriceId)
      return 'starter';
    return 'trial';
  }

  private mapSubscriptionStatus(status: string): string {
    const map: Record<string, string> = {
      active: 'active',
      past_due: 'past_due',
      canceled: 'canceled',
      trialing: 'trialing',
    };
    return map[status] ?? 'active';
  }

  private resolvePriceIdForPlanCycle(
    planType: 'starter' | 'professional',
    cycle: 'monthly' | 'yearly',
  ): string {
    const starterMonthly = (
      this.config.get<string>('stripe.starterPriceId') ?? ''
    ).trim();
    const starterYearly = (
      this.config.get<string>('stripe.starterYearlyPriceId') ?? ''
    ).trim();
    const proMonthly = (
      this.config.get<string>('stripe.proPriceId') ?? ''
    ).trim();
    const proYearly = (
      this.config.get<string>('stripe.proYearlyPriceId') ?? ''
    ).trim();

    if (planType === 'starter' && cycle === 'monthly') {
      if (!starterMonthly)
        throw new BadRequestException('Starter monthly plan is not configured');
      return starterMonthly;
    }
    if (planType === 'starter' && cycle === 'yearly') {
      if (!starterYearly)
        throw new BadRequestException('Starter yearly plan is not configured');
      return starterYearly;
    }
    if (planType === 'professional' && cycle === 'monthly') {
      if (!proMonthly)
        throw new BadRequestException(
          'Professional monthly plan is not configured',
        );
      return proMonthly;
    }
    if (planType === 'professional' && cycle === 'yearly') {
      if (!proYearly)
        throw new BadRequestException(
          'Professional yearly plan is not configured',
        );
      return proYearly;
    }

    throw new BadRequestException('Unsupported plan cycle');
  }

  private getPlanLimits(
    plan: PlanTier,
    currentUsers: number,
    currentMailboxes: number,
    currentStorageGb: number,
  ): { maxUsers?: number; maxMailboxes?: number; maxStorageGb?: number } {
    if (plan === 'trial') {
      return { maxUsers: 1, maxMailboxes: 1, maxStorageGb: 1 };
    }

    if (plan === 'starter') {
      return { maxUsers: 5, maxMailboxes: 3, maxStorageGb: 10 };
    }

    if (plan === 'professional') {
      return { maxUsers: 1000, maxMailboxes: 1000, maxStorageGb: 100 };
    }

    return {
      maxUsers: currentUsers,
      maxMailboxes: currentMailboxes,
      maxStorageGb: currentStorageGb,
    };
  }

  private async getStripeCustomer(
    customerId?: string | null,
  ): Promise<Stripe.Customer | null> {
    if (!customerId) return null;
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if (typeof customer === 'string' || customer.deleted) return null;
      return customer;
    } catch {
      return null;
    }
  }

  private async resolvePaymentMethod(
    customer: Stripe.Customer | null,
    subscription: Stripe.Subscription | null,
  ): Promise<object | null> {
    let candidate =
      (
        subscription as unknown as {
          default_payment_method?: string | Stripe.PaymentMethod | null;
        }
      )?.default_payment_method ?? null;
    if (!candidate && customer?.invoice_settings) {
      candidate = customer.invoice_settings.default_payment_method ?? null;
    }
    if (!candidate) return null;

    let paymentMethod: Stripe.PaymentMethod | null = null;
    if (typeof candidate === 'string') {
      try {
        paymentMethod = await this.stripe.paymentMethods.retrieve(candidate);
      } catch {
        paymentMethod = null;
      }
    } else {
      paymentMethod = candidate;
    }

    if (
      !paymentMethod ||
      paymentMethod.type !== 'card' ||
      !paymentMethod.card
    ) {
      return null;
    }

    return {
      id: paymentMethod.id,
      brand: paymentMethod.card.brand,
      last4: paymentMethod.card.last4,
      expMonth: paymentMethod.card.exp_month,
      expYear: paymentMethod.card.exp_year,
    };
  }

  private async listInvoices(customerId?: string | null): Promise<object[]> {
    if (!customerId) return [];

    try {
      const invoiceList = await this.stripe.invoices.list({
        customer: customerId,
        limit: 20,
      });

      return invoiceList.data.map((invoice) => ({
        id: invoice.id,
        invoiceId: invoice.number ?? invoice.id,
        date: new Date(invoice.created * 1000),
        amount: Number(
          ((invoice.amount_paid || invoice.amount_due || 0) / 100).toFixed(2),
        ),
        currency: invoice.currency,
        status: invoice.status,
        invoicePdf: invoice.invoice_pdf,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
      }));
    } catch {
      return [];
    }
  }

  private async getTaxNumber(
    customerId?: string | null,
  ): Promise<string | null> {
    if (!customerId) return null;
    try {
      const taxIds = await this.stripe.customers.listTaxIds(customerId, {
        limit: 1,
      });
      return taxIds.data[0]?.value ?? null;
    } catch {
      return null;
    }
  }

  private resolveCheckoutPriceId(dto: CreateCheckoutDto): string {
    const explicitPriceId = dto.priceId?.trim();
    if (explicitPriceId) {
      return explicitPriceId;
    }

    const normalizedPlanType = (dto.planType ?? '').trim().toLowerCase();
    const normalizedCycle = (dto.cycle ?? 'monthly').trim().toLowerCase() as
      | 'monthly'
      | 'yearly';

    if (normalizedPlanType === 'starter') {
      return this.resolvePriceIdForPlanCycle('starter', normalizedCycle);
    }

    if (normalizedPlanType === 'professional' || normalizedPlanType === 'pro') {
      return this.resolvePriceIdForPlanCycle('professional', normalizedCycle);
    }

    if (
      normalizedPlanType === 'enterprise' ||
      normalizedPlanType === 'trial' ||
      normalizedPlanType === 'free'
    ) {
      throw new BadRequestException(
        'Selected plan does not support self-serve checkout',
      );
    }

    throw new BadRequestException('priceId or a valid planType is required');
  }
}
