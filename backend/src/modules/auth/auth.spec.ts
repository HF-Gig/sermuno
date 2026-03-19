// Mock otplib to avoid ESM transform issues with @scure/base
jest.mock('otplib', () => ({
  generateSecret: jest.fn().mockReturnValue('JBSWY3DPEHPK3PXP'),
  generateURI: jest
    .fn()
    .mockReturnValue(
      'otpauth://totp/Sermuno:test@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Sermuno',
    ),
  verifySync: jest.fn().mockReturnValue(true),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../database/prisma.service';
import { EMAIL_SYNC_QUEUE } from '../../jobs/queues/email-sync.queue';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  organization: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-token'),
  decode: jest
    .fn()
    .mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  verify: jest.fn(),
};

const mockEmailSyncQueue = {
  add: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, unknown> = {
      'jwt.secret': 'test-secret',
      'jwt.refreshSecret': 'test-refresh-secret',
      'jwt.expiresIn': '7d',
      'jwt.refreshExpiresIn': '30d',
      'bcrypt.rounds': 10,
      'encryption.key': 'test-encryption-key-32-characters!',
    };
    return map[key];
  }),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: `BullQueue_${EMAIL_SYNC_QUEUE}`,
          useValue: mockEmailSyncQueue,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('validatePassword', () => {
    it('returns null when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await service.validatePassword('a@b.com', 'pass');
      expect(result).toBeNull();
    });

    it('returns null when user is inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        isActive: false,
        deletedAt: null,
        passwordHash: '$2a$10$foo',
      });
      const result = await service.validatePassword('a@b.com', 'pass');
      expect(result).toBeNull();
    });
  });

  describe('register', () => {
    it('throws ConflictException if email already in use', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'a@b.com',
      });
      await expect(
        service.register({
          email: 'a@b.com',
          password: 'Pass1234!',
          fullName: 'Test',
          organizationName: 'Org',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates org and user on successful registration', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organization.create.mockResolvedValue({
        id: 'org-1',
        name: 'My Org',
      });
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        fullName: 'Test',
        organizationId: 'org-1',
        role: 'ADMIN',
        passwordHash: 'hashed',
        mfaSecret: null,
        inviteToken: null,
        inviteExpiresAt: null,
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        fullName: 'Test',
        organizationId: 'org-1',
        role: 'ADMIN',
        passwordHash: 'hashed',
        mfaSecret: null,
        inviteToken: null,
        inviteExpiresAt: null,
      });

      const result = await service.register({
        email: 'a@b.com',
        password: 'Pass1234!',
        fullName: 'Test',
        organizationName: 'My Org',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(mockPrisma.organization.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('logout', () => {
    it('returns without throwing when refreshToken provided', async () => {
      await service.logout('user-1', 'some-token');
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    });

    it('returns without throwing when no refreshToken', async () => {
      await service.logout('user-1');
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('encrypt / decrypt', () => {
    it('round-trips plaintext correctly', () => {
      const plaintext = 'JBSWY3DPEHPK3PXP';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('refresh', () => {
    it('throws UnauthorizedException on invalid refresh token', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('expired');
      });
      await expect(
        service.refresh({ refreshToken: 'bad-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
