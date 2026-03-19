import { Test, TestingModule } from '@nestjs/testing';
import { AttachmentStorageService } from './attachment-storage.service';
import { ConfigService } from '@nestjs/config';

const mockConfigService = {
  get: jest.fn((key: string) => {
    const config: Record<string, string | number> = {
      'attachment.storageType': 'local',
      'attachment.s3Bucket': '',
      'attachment.s3Region': 'us-east-1',
      'attachment.s3Endpoint': '',
      'attachment.s3AccessKey': '',
      'attachment.s3SecretKey': '',
      'attachment.maxDirectBytes': 10485760,
    };
    return config[key];
  }),
};

describe('AttachmentStorageService', () => {
  let service: AttachmentStorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentStorageService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AttachmentStorageService>(AttachmentStorageService);
  });

  describe('generateStorageKey', () => {
    it('generates a key with org prefix and extension', () => {
      const key = service.generateStorageKey('org-1', 'test.pdf');
      expect(key).toMatch(/^org-1\/[a-f0-9]{32}\.pdf$/);
    });

    it('generates unique keys', () => {
      const key1 = service.generateStorageKey('org-1', 'file.txt');
      const key2 = service.generateStorageKey('org-1', 'file.txt');
      expect(key1).not.toBe(key2);
    });
  });

  describe('requiresPresign', () => {
    it('returns false for local storage', () => {
      expect(service.requiresPresign(50_000_000)).toBe(false);
    });
  });

  describe('upload (local)', () => {
    it('writes file and returns storageKey', async () => {
      const buf = Buffer.from('hello world');
      const key = service.generateStorageKey('org-1', 'test.txt');
      const result = await service.upload(key, buf, 'text/plain');
      expect(result).toBe(key);
    });
  });

  describe('delete (local)', () => {
    it('does not throw when file does not exist', async () => {
      await expect(
        service.delete('nonexistent/key.txt'),
      ).resolves.toBeUndefined();
    });
  });

  describe('presignedPutUrl', () => {
    it('throws when not using S3', async () => {
      await expect(
        service.presignedPutUrl('key', 'application/pdf'),
      ).rejects.toThrow();
    });
  });
});
