import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { CalendarService } from './calendar.service';
import { IcsGeneratorService } from './ics-generator.service';
import { VideoConferencingService } from './video-conferencing.service';
import { CalendarSyncService } from './calendar-sync.service';
import { CalendarTemplatesService } from './calendar-templates.service';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { NOTIFICATION_DISPATCH_QUEUE } from '../../jobs/queues/notification-dispatch.queue';

// ──────────────────────────────────────────────────────────────────────────────
// Shared mocks
// ──────────────────────────────────────────────────────────────────────────────

const mockUser = {
  sub: 'user-1',
  email: 'test@example.com',
  organizationId: 'org-1',
  role: 'USER',
  permissions: [],
};

const mockEvent = {
  id: 'event-1',
  organizationId: 'org-1',
  organizerId: 'user-1',
  title: 'Test Event',
  description: null,
  startTime: new Date('2026-04-01T10:00:00Z'),
  endTime: new Date('2026-04-01T11:00:00Z'),
  allDay: false,
  timezone: 'UTC',
  status: 'confirmed',
  visibility: 'default',
  recurrenceRule: null,
  recurrenceEnd: null,
  reminders: [],
  color: null,
  location: null,
  meetingLink: null,
  meetingProvider: null,
  meetingId: null,
  meetingPassword: null,
  linkedThreadId: null,
  linkedContactId: null,
  linkedCompanyId: null,
  templateId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  attendees: [],
};

const mockPrisma = {
  event: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    updateMany: jest.fn(),
  },
  eventAttendee: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  calendarTemplate: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  contact: {
    findFirst: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

const mockQueue = {
  add: jest.fn().mockResolvedValue({}),
};

const mockIcsGenerator = {
  generate: jest
    .fn()
    .mockReturnValue(
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR',
    ),
};

const mockVideoConf = {
  createGoogleMeet: jest.fn(),
  createZoomMeeting: jest.fn(),
  createTeamsMeeting: jest.fn(),
};

const mockCalendarSync = {
  syncGoogle: jest.fn().mockResolvedValue({ synced: 0, deleted: 0 }),
  syncMicrosoft: jest.fn().mockResolvedValue({ synced: 0, deleted: 0 }),
  syncCalDav: jest.fn().mockResolvedValue({ synced: 0, deleted: 0 }),
};

const mockTemplates = {
  findAll: jest.fn().mockResolvedValue([]),
  create: jest.fn(),
  createEventFromTemplate: jest.fn(),
};

const mockNotifications = {
  dispatch: jest.fn().mockResolvedValue(undefined),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      'jwt.secret': 'test-secret-32-chars-padding-here',
      'encryption.key': 'test-encryption-key-32-chars-pad',
    };
    return map[key] ?? '';
  }),
};

// ──────────────────────────────────────────────────────────────────────────────
// CalendarService tests
// ──────────────────────────────────────────────────────────────────────────────

describe('CalendarService', () => {
  let service: CalendarService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: IcsGeneratorService, useValue: mockIcsGenerator },
        { provide: VideoConferencingService, useValue: mockVideoConf },
        { provide: CalendarSyncService, useValue: mockCalendarSync },
        { provide: CalendarTemplatesService, useValue: mockTemplates },
        {
          provide: getQueueToken(NOTIFICATION_DISPATCH_QUEUE),
          useValue: mockQueue,
        },
        { provide: 'NOTIFICATIONS_SERVICE', useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<CalendarService>(CalendarService);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // findAll
  // ──────────────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns events for the user org', async () => {
      mockPrisma.event.findMany.mockResolvedValue([mockEvent]);
      const result = await service.findAll(mockUser);
      expect(result).toEqual([mockEvent]);
      expect(mockPrisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: 'org-1' }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // create
  // ──────────────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates an event with no meeting provider', async () => {
      mockPrisma.event.create.mockResolvedValue(mockEvent);
      mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        preferences: null,
      });

      const dto = {
        title: 'Test Event',
        startTime: new Date('2026-04-01T10:00:00Z'),
        endTime: new Date('2026-04-01T11:00:00Z'),
      };

      const result = await service.create(dto, mockUser);
      expect(result).toEqual(mockEvent);
      expect(mockPrisma.event.create).toHaveBeenCalled();
    });

    it('creates attendees when provided', async () => {
      mockPrisma.event.create.mockResolvedValue(mockEvent);
      mockPrisma.event.findUnique.mockResolvedValue({
        ...mockEvent,
        attendees: [],
      });
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        preferences: null,
      });
      mockPrisma.eventAttendee.findFirst.mockResolvedValue(null);
      mockPrisma.eventAttendee.create.mockResolvedValue({});
      mockPrisma.contact.findFirst.mockResolvedValue(null);

      const dto = {
        title: 'Event with Attendees',
        startTime: new Date(),
        endTime: new Date(),
        attendees: [{ email: 'attendee@example.com', name: 'Attendee' }],
      };

      await service.create(dto, mockUser);
      expect(mockPrisma.eventAttendee.create).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // findOne
  // ──────────────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns event when found', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(mockEvent);
      const result = await service.findOne('event-1', mockUser);
      expect(result).toEqual(mockEvent);
    });

    it('throws NotFoundException when event not found', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // update
  // ──────────────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates event fields', async () => {
      const updated = { ...mockEvent, title: 'Updated Title' };
      mockPrisma.event.findFirst.mockResolvedValue(mockEvent);
      mockPrisma.event.update.mockResolvedValue(updated);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.update(
        'event-1',
        { title: 'Updated Title' },
        mockUser,
      );
      expect(result.title).toBe('Updated Title');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // remove
  // ──────────────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes the event', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(mockEvent);
      mockPrisma.event.delete.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      await expect(
        service.remove('event-1', mockUser),
      ).resolves.toBeUndefined();
      expect(mockPrisma.event.delete).toHaveBeenCalledWith({
        where: { id: 'event-1' },
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getAttendees
  // ──────────────────────────────────────────────────────────────────────────

  describe('getAttendees', () => {
    it('returns attendees for event', async () => {
      const attendees = [
        {
          id: 'att-1',
          eventId: 'event-1',
          email: 'a@b.com',
          rsvpStatus: 'pending',
        },
      ];
      mockPrisma.event.findFirst.mockResolvedValue(mockEvent);
      mockPrisma.eventAttendee.findMany.mockResolvedValue(attendees);

      const result = await service.getAttendees('event-1', mockUser);
      expect(result).toEqual(attendees);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // sendInvite
  // ──────────────────────────────────────────────────────────────────────────

  describe('sendInvite', () => {
    it('generates ICS and enqueues emails', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(mockEvent);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'org@example.com',
        fullName: 'Org User',
      });
      mockPrisma.eventAttendee.findMany.mockResolvedValue([
        { id: 'att-1', eventId: 'event-1', email: 'att@example.com' },
      ]);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.sendInvite('event-1', {}, mockUser);

      expect(mockIcsGenerator.generate).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalled();
      expect(result.sent).toBeGreaterThanOrEqual(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // rsvp
  // ──────────────────────────────────────────────────────────────────────────

  describe('rsvp', () => {
    it('creates attendee record when none exists', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(mockEvent);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockPrisma.eventAttendee.findFirst.mockResolvedValue(null);
      mockPrisma.eventAttendee.create.mockResolvedValue({
        id: 'att-new',
        rsvpStatus: 'accepted',
      });

      const result = await service.rsvp(
        'event-1',
        { status: 'accepted' },
        mockUser,
      );
      expect(mockPrisma.eventAttendee.create).toHaveBeenCalled();
      expect(result).toHaveProperty('rsvpStatus', 'accepted');
    });

    it('updates existing attendee record', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(mockEvent);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
      });
      mockPrisma.eventAttendee.findFirst.mockResolvedValue({
        id: 'att-1',
        email: 'test@example.com',
      });
      mockPrisma.eventAttendee.update.mockResolvedValue({
        id: 'att-1',
        rsvpStatus: 'declined',
      });

      const result = await service.rsvp(
        'event-1',
        { status: 'declined' },
        mockUser,
      );
      expect(mockPrisma.eventAttendee.update).toHaveBeenCalled();
      expect(result).toHaveProperty('rsvpStatus', 'declined');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getRsvpPublic
  // ──────────────────────────────────────────────────────────────────────────

  describe('getRsvpPublic', () => {
    it('returns event for valid token', async () => {
      const crypto = require('crypto');
      const secret = 'test-secret-32-chars-padding-here';
      const token = crypto
        .createHmac('sha256', secret)
        .update('event-1')
        .digest('hex');

      mockPrisma.event.findUnique.mockResolvedValue(mockEvent);

      const result = await service.getRsvpPublic('event-1', token);
      expect(result).toEqual(mockEvent);
    });

    it('throws BadRequestException for invalid token', async () => {
      await expect(
        service.getRsvpPublic('event-1', 'bad-token'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ingestRsvp
  // ──────────────────────────────────────────────────────────────────────────

  describe('ingestRsvp', () => {
    it('parses iCal REPLY and updates attendee status', async () => {
      const rawIcal = [
        'BEGIN:VCALENDAR',
        'METHOD:REPLY',
        'BEGIN:VEVENT',
        'UID:event-ext-1',
        'ATTENDEE;PARTSTAT=ACCEPTED:mailto:att@example.com',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      mockPrisma.event.findFirst.mockResolvedValue({
        id: 'event-1',
        externalId: 'event-ext-1',
      });
      mockPrisma.eventAttendee.findFirst.mockResolvedValue({
        id: 'att-1',
        email: 'att@example.com',
      });
      mockPrisma.eventAttendee.update.mockResolvedValue({
        id: 'att-1',
        rsvpStatus: 'accepted',
      });

      const result = await service.ingestRsvp({ rawIcal });
      expect(result.updated).toBe(1);
    });

    it('returns 0 updated when no UID matches', async () => {
      const rawIcal =
        'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:unknown\r\nEND:VEVENT\r\nEND:VCALENDAR';
      mockPrisma.event.findFirst.mockResolvedValue(null);

      const result = await service.ingestRsvp({ rawIcal });
      expect(result.updated).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // generateIcsFeed
  // ──────────────────────────────────────────────────────────────────────────

  describe('generateIcsFeed', () => {
    it('throws NotFoundException for unknown user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.generateIcsFeed('unknown-user')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns combined iCal for user events', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'u@example.com',
        fullName: 'User',
      });
      mockPrisma.event.findMany.mockResolvedValue([mockEvent]);

      const result = await service.generateIcsFeed('user-1');
      expect(typeof result).toBe('string');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Templates delegation
  // ──────────────────────────────────────────────────────────────────────────

  describe('getTemplates', () => {
    it('delegates to CalendarTemplatesService', async () => {
      mockTemplates.findAll.mockResolvedValue([]);
      const result = await service.getTemplates(mockUser);
      expect(result).toEqual([]);
      expect(mockTemplates.findAll).toHaveBeenCalledWith('org-1');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Sync delegation
  // ──────────────────────────────────────────────────────────────────────────

  describe('syncGoogle', () => {
    it('delegates to CalendarSyncService', async () => {
      const result = await service.syncGoogle('token', mockUser);
      expect(mockCalendarSync.syncGoogle).toHaveBeenCalledWith({
        userId: 'user-1',
        organizationId: 'org-1',
        accessToken: 'token',
      });
      expect(result).toEqual({ synced: 0, deleted: 0 });
    });
  });

  describe('syncMicrosoft', () => {
    it('delegates to CalendarSyncService', async () => {
      const result = await service.syncMicrosoft('token', mockUser);
      expect(mockCalendarSync.syncMicrosoft).toHaveBeenCalled();
      expect(result).toEqual({ synced: 0, deleted: 0 });
    });
  });

  describe('syncCalDav', () => {
    it('delegates to CalendarSyncService', async () => {
      const result = await service.syncCalDav(
        'https://dav.example.com',
        'user',
        'pass',
        mockUser,
      );
      expect(mockCalendarSync.syncCalDav).toHaveBeenCalled();
      expect(result).toEqual({ synced: 0, deleted: 0 });
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// IcsGeneratorService tests
// ──────────────────────────────────────────────────────────────────────────────

describe('IcsGeneratorService', () => {
  let icsService: IcsGeneratorService;

  beforeEach(() => {
    icsService = new IcsGeneratorService();
  });

  it('generates valid ICS string with required fields', () => {
    const ics = icsService.generate({
      id: 'test-id',
      title: 'Test Meeting',
      startTime: new Date('2026-04-01T10:00:00Z'),
      endTime: new Date('2026-04-01T11:00:00Z'),
      timezone: 'UTC',
      organizerEmail: 'org@example.com',
      attendees: [{ email: 'att@example.com', name: 'Attendee' }],
    });

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('Test Meeting');
    expect(ics).toContain('org@example.com');
    // Email may be line-folded per RFC 5545 — check for the prefix before possible fold
    expect(ics).toContain('att@example.c');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('includes RRULE for recurring events', () => {
    const ics = icsService.generate({
      id: 'rec-id',
      title: 'Weekly Meeting',
      startTime: new Date('2026-04-01T10:00:00Z'),
      endTime: new Date('2026-04-01T11:00:00Z'),
      organizerEmail: 'org@example.com',
      attendees: [],
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    });

    expect(ics).toContain('RRULE');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CalendarTemplatesService tests
// ──────────────────────────────────────────────────────────────────────────────

describe('CalendarTemplatesService', () => {
  let service: CalendarTemplatesService;
  const templatesPrisma = {
    calendarTemplate: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    event: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarTemplatesService,
        { provide: PrismaService, useValue: templatesPrisma },
        { provide: VideoConferencingService, useValue: mockVideoConf },
      ],
    }).compile();

    service = module.get<CalendarTemplatesService>(CalendarTemplatesService);
  });

  it('findAll returns templates for org', async () => {
    templatesPrisma.calendarTemplate.findMany.mockResolvedValue([]);
    const result = await service.findAll('org-1');
    expect(result).toEqual([]);
  });

  it('create persists template', async () => {
    const created = { id: 'tmpl-1', name: 'Sales Call', title: 'Sales Call' };
    templatesPrisma.calendarTemplate.create.mockResolvedValue(created);

    const result = await service.create(
      { name: 'Sales Call', title: 'Sales Call' },
      'org-1',
      'user-1',
    );
    expect(result).toEqual(created);
  });

  it('createEventFromTemplate throws when required field missing', async () => {
    templatesPrisma.calendarTemplate.findFirst.mockResolvedValue({
      id: 'tmpl-1',
      requiredFields: ['contactName'],
      invitationTemplate: 'Hello {{contactName}}',
      title: 'Call',
      description: null,
      durationMinutes: 30,
      location: null,
      meetingLink: null,
      meetingProvider: null,
      isActive: true,
    });

    await expect(
      service.createEventFromTemplate('tmpl-1', {}, 'org-1', 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('createEventFromTemplate renders Handlebars and creates event', async () => {
    templatesPrisma.calendarTemplate.findFirst.mockResolvedValue({
      id: 'tmpl-1',
      requiredFields: [],
      invitationTemplate: 'Hello {{name}}',
      title: 'Call with {{name}}',
      description: null,
      durationMinutes: 30,
      location: null,
      meetingLink: null,
      meetingProvider: null,
      isActive: true,
    });
    templatesPrisma.event.create.mockResolvedValue({ id: 'event-new' });

    const result = await service.createEventFromTemplate(
      'tmpl-1',
      { name: 'Alice' },
      'org-1',
      'user-1',
    );
    expect(result).toHaveProperty('id', 'event-new');
  });
});
