import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventsGateway } from './events.gateway';
import { PrismaService } from '../../database/prisma.service';

const mockJwtService = {
  verify: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('test-secret'),
};

const mockPrisma = {
  mailboxAccess: {
    findMany: jest.fn(),
  },
};

/** Build a minimal fake socket */
function makeMockSocket(token?: string) {
  return {
    id: 'socket-1',
    handshake: {
      auth: token !== undefined ? { token } : {},
      headers: {},
    },
    data: {} as Record<string, unknown>,
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    emit: jest.fn(),
  };
}

/** Build a minimal fake server */
function makeMockServer() {
  const mockFetchSockets = jest.fn().mockResolvedValue([]);
  return {
    to: jest.fn().mockReturnValue({
      emit: jest.fn(),
    }),
    in: jest.fn().mockReturnValue({
      fetchSockets: mockFetchSockets,
    }),
    emit: jest.fn(),
  };
}

describe('EventsGateway', () => {
  let gateway: EventsGateway;
  let mockServer: ReturnType<typeof makeMockServer>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    gateway = module.get(EventsGateway);
    mockServer = makeMockServer();
    // Inject fake server onto the gateway
    (gateway as unknown as { server: unknown }).server = mockServer;
  });

  // ---------------------------------------------------------------------------
  // handleConnection
  // ---------------------------------------------------------------------------
  describe('handleConnection', () => {
    it('disconnects when no token is provided', async () => {
      const socket = makeMockSocket(undefined);
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('disconnects when JWT is invalid', async () => {
      const socket = makeMockSocket('bad-token');
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });
      await gateway.handleConnection(socket as never);
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('joins user room and mailbox rooms on valid token', async () => {
      const socket = makeMockSocket('valid-token');
      mockJwtService.verify.mockReturnValue({
        sub: 'user-1',
        organizationId: 'org-1',
      });
      mockPrisma.mailboxAccess.findMany.mockResolvedValue([
        { mailboxId: 'mb-1' },
      ]);

      await gateway.handleConnection(socket as never);

      expect(socket.join).toHaveBeenCalledWith('user:user-1');
      expect(socket.join).toHaveBeenCalledWith('mailbox:mb-1');
    });

    it('emits presence:snapshot on connect', async () => {
      const socket = makeMockSocket('valid-token');
      mockJwtService.verify.mockReturnValue({
        sub: 'user-1',
        organizationId: 'org-1',
      });
      mockPrisma.mailboxAccess.findMany.mockResolvedValue([
        { mailboxId: 'mb-1' },
      ]);

      await gateway.handleConnection(socket as never);

      expect(socket.emit).toHaveBeenCalledWith(
        'presence:snapshot',
        expect.any(Object),
      );
    });

    it('sets socket.data with userId and organizationId', async () => {
      const socket = makeMockSocket('valid-token');
      mockJwtService.verify.mockReturnValue({
        sub: 'user-2',
        organizationId: 'org-2',
      });
      mockPrisma.mailboxAccess.findMany.mockResolvedValue([]);

      await gateway.handleConnection(socket as never);

      expect(
        (socket as unknown as { data: Record<string, unknown> }).data.userId,
      ).toBe('user-2');
      expect(
        (socket as unknown as { data: Record<string, unknown> }).data
          .organizationId,
      ).toBe('org-2');
    });
  });

  // ---------------------------------------------------------------------------
  // handleDisconnect
  // ---------------------------------------------------------------------------
  describe('handleDisconnect', () => {
    it('removes user from presence map on disconnect', () => {
      const socket = makeMockSocket('t');
      (socket as unknown as { data: Record<string, unknown> }).data = {
        userId: 'user-1',
        organizationId: 'org-1',
        mailboxIds: [],
      };
      // Seed presence map via internal access
      const presenceMap = (
        gateway as unknown as { presenceMap: Map<string, string> }
      ).presenceMap;
      presenceMap.set('user-1', 'online');

      gateway.handleDisconnect(socket as never);

      expect(presenceMap.has('user-1')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // presence:state
  // ---------------------------------------------------------------------------
  describe('handlePresenceState', () => {
    it('broadcasts presence:changed to mailbox rooms', () => {
      const socket = makeMockSocket('t');
      (socket as unknown as { data: Record<string, unknown> }).data = {
        userId: 'user-1',
        organizationId: 'org-1',
        mailboxIds: ['mb-1'],
      };

      gateway.handlePresenceState(socket as never, { status: 'busy' });

      expect(mockServer.to).toHaveBeenCalledWith('mailbox:mb-1');
    });

    it('does nothing if socket has no userId', () => {
      const socket = makeMockSocket('t');
      (socket as unknown as { data: Record<string, unknown> }).data = {};

      gateway.handlePresenceState(socket as never, { status: 'busy' });

      expect(mockServer.to).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // typing:subscribe
  // ---------------------------------------------------------------------------
  describe('handleTypingSubscribe', () => {
    it('joins the thread room', async () => {
      const socket = makeMockSocket('t');
      await gateway.handleTypingSubscribe(socket as never, {
        threadId: 'th-1',
      });
      expect(socket.join).toHaveBeenCalledWith('thread:th-1');
    });
  });

  // ---------------------------------------------------------------------------
  // typing:start / typing:stop
  // ---------------------------------------------------------------------------
  describe('handleTypingStart / handleTypingStop', () => {
    it('emits typing:changed with typing=true', () => {
      const socket = makeMockSocket('t');
      (socket as unknown as { data: Record<string, unknown> }).data = {
        userId: 'user-1',
        organizationId: 'org-1',
        mailboxIds: [],
      };

      gateway.handleTypingStart(socket as never, { threadId: 'th-1' });

      expect(mockServer.to).toHaveBeenCalledWith('thread:th-1');
    });

    it('emits typing:changed with typing=false', () => {
      const socket = makeMockSocket('t');
      (socket as unknown as { data: Record<string, unknown> }).data = {
        userId: 'user-1',
        organizationId: 'org-1',
        mailboxIds: [],
      };

      gateway.handleTypingStop(socket as never, { threadId: 'th-1' });

      expect(mockServer.to).toHaveBeenCalledWith('thread:th-1');
    });
  });

  // ---------------------------------------------------------------------------
  // emitToUser
  // ---------------------------------------------------------------------------
  describe('emitToUser', () => {
    it('emits the event to the user room', () => {
      gateway.emitToUser('user-1', 'notification', { id: 'n-1' });
      expect(mockServer.to).toHaveBeenCalledWith('user:user-1');
    });
  });
});
