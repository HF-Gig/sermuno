import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';

// Mock Stripe constructor so no real HTTP calls happen
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    subscriptions: { retrieve: jest.fn() },
    customers: {
      create: jest.fn(),
      retrieve: jest.fn(),
      listTaxIds: jest.fn(),
    },
    checkout: { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
    paymentMethods: { retrieve: jest.fn() },
    invoices: { list: jest.fn(), retrieve: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  }));
});

import Stripe from 'stripe';

const mockPrisma = {
  organization: {
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  user: { count: jest.fn() },
  mailbox: { count: jest.fn() },
  attachment: { aggregate: jest.fn() },
};

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      'stripe.secretKey': 'sk_test_fake',
      'stripe.webhookSecret': 'whsec_fake',
      'stripe.proPriceId': 'price_pro',
      'stripe.starterPriceId': 'price_starter',
      'frontend.url': 'http://localhost:5173',
    };
    return map[key];
  }),
};

describe('BillingService', () => {
  let service: BillingService;
  let stripeInstance: jest.Mocked<Stripe>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.mailbox.count.mockResolvedValue(0);
    mockPrisma.attachment.aggregate.mockResolvedValue({
      _sum: { sizeBytes: 0 },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    // Get the Stripe instance created inside the service
    stripeInstance = (Stripe as jest.MockedClass<typeof Stripe>).mock.results[0]
      .value as jest.Mocked<Stripe>;
  });

  describe('getInfo', () => {
    it('throws NotFoundException when org not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.getInfo('org-1')).rejects.toThrow(NotFoundException);
    });

    it('returns billing info without subscription when no stripeSubscriptionId', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        plan: 'trial',
        subscriptionStatus: 'active',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        maxMailboxes: 1,
        maxUsers: 5,
        maxStorageGb: 5,
      });
      const result = (await service.getInfo('org-1')) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('plan', 'trial');
      expect(result).toHaveProperty('usage.usersUsed', 0);
      expect(result.subscription).toBeNull();
    });
  });

  describe('createCheckout', () => {
    it('throws NotFoundException when org not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(
        service.createCheckout('org-1', { priceId: 'price_pro' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a Stripe customer if none exists, then returns checkout URL', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        stripeCustomerId: null,
      });
      mockPrisma.organization.update.mockResolvedValue({});
      (stripeInstance.customers.create as jest.Mock).mockResolvedValue({
        id: 'cus_123',
      });
      (stripeInstance.checkout.sessions.create as jest.Mock).mockResolvedValue({
        url: 'https://checkout.stripe.com/pay/cs_test',
      });

      const result = await service.createCheckout('org-1', {
        priceId: 'price_pro',
      });
      expect(result).toEqual({
        url: 'https://checkout.stripe.com/pay/cs_test',
      });
      expect(stripeInstance.customers.create).toHaveBeenCalledTimes(1);
    });

    it('maps planType to Stripe price id when priceId is omitted', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        stripeCustomerId: 'cus_123',
      });
      (stripeInstance.checkout.sessions.create as jest.Mock).mockResolvedValue({
        url: 'https://checkout.stripe.com/pay/cs_test',
      });

      await service.createCheckout('org-1', { planType: 'starter' });

      expect(stripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: 'price_starter', quantity: 1 }],
        }),
      );
    });

    it('rejects unsupported self-serve plan types', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        stripeCustomerId: 'cus_123',
      });

      await expect(
        service.createCheckout('org-1', { planType: 'enterprise' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createPortal', () => {
    it('throws BadRequestException when no Stripe customer', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        stripeCustomerId: null,
      });
      await expect(service.createPortal('org-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns portal URL when customer exists', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        stripeCustomerId: 'cus_123',
      });
      (
        stripeInstance.billingPortal.sessions.create as jest.Mock
      ).mockResolvedValue({
        url: 'https://billing.stripe.com/session/bps_test',
      });
      const result = await service.createPortal('org-1', {});
      expect(result).toEqual({
        url: 'https://billing.stripe.com/session/bps_test',
      });
    });
  });
});
