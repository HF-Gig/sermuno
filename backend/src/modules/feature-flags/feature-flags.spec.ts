import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagsService } from '../../config/feature-flags.service';

describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;

  beforeEach(async () => {
    // Clear any env overrides before each test
    const flagKeys = [
      'ENABLE_IMAP_SYNC',
      'ENABLE_CALENDAR',
      'ENABLE_WEBHOOKS',
      'ENABLE_STREAMING_SYNC',
      'ENABLE_PUSH_NOTIFICATIONS',
      'ENABLE_SLACK_NOTIFICATIONS',
      'ENABLE_CRM_AUTO_CREATE',
    ];
    for (const key of flagKeys) {
      delete process.env[key];
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [FeatureFlagsService],
    }).compile();

    service = module.get<FeatureFlagsService>(FeatureFlagsService);
  });

  describe('getAll', () => {
    it('returns all 7 feature flags', () => {
      const flags = service.getAll();
      expect(Object.keys(flags)).toHaveLength(7);
      expect(flags).toHaveProperty('ENABLE_IMAP_SYNC');
      expect(flags).toHaveProperty('ENABLE_CALENDAR');
      expect(flags).toHaveProperty('ENABLE_WEBHOOKS');
      expect(flags).toHaveProperty('ENABLE_STREAMING_SYNC');
      expect(flags).toHaveProperty('ENABLE_PUSH_NOTIFICATIONS');
      expect(flags).toHaveProperty('ENABLE_SLACK_NOTIFICATIONS');
      expect(flags).toHaveProperty('ENABLE_CRM_AUTO_CREATE');
    });

    it('ENABLE_IMAP_SYNC defaults to true when env var absent', () => {
      const flags = service.getAll();
      expect(flags.ENABLE_IMAP_SYNC).toBe(true);
    });

    it('ENABLE_STREAMING_SYNC defaults to false when env var absent', () => {
      const flags = service.getAll();
      expect(flags.ENABLE_STREAMING_SYNC).toBe(false);
    });

    it('ENABLE_PUSH_NOTIFICATIONS defaults to false when env var absent', () => {
      const flags = service.getAll();
      expect(flags.ENABLE_PUSH_NOTIFICATIONS).toBe(false);
    });
  });

  describe('get', () => {
    it('reads a single flag', () => {
      expect(service.get('ENABLE_CALENDAR')).toBe(true);
    });

    it('returns false when env var set to false', () => {
      process.env['ENABLE_CALENDAR'] = 'false';
      expect(service.get('ENABLE_CALENDAR')).toBe(false);
    });
  });

  describe('patch', () => {
    it('disables a flag', () => {
      const result = service.patch({ ENABLE_IMAP_SYNC: false });
      expect(result.ENABLE_IMAP_SYNC).toBe(false);
    });

    it('enables a flag', () => {
      process.env['ENABLE_STREAMING_SYNC'] = 'false';
      const result = service.patch({ ENABLE_STREAMING_SYNC: true });
      expect(result.ENABLE_STREAMING_SYNC).toBe(true);
    });

    it('returns all flags after patching', () => {
      const result = service.patch({ ENABLE_WEBHOOKS: false });
      expect(Object.keys(result)).toHaveLength(7);
      expect(result.ENABLE_WEBHOOKS).toBe(false);
    });

    it('ignores unknown keys', () => {
      // Should not throw
      expect(() =>
        service.patch({ ENABLE_IMAP_SYNC: true } as never),
      ).not.toThrow();
    });
  });
});
