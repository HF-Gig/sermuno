import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../database/prisma.service';

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    organizationId: string;
    mailboxIds: string[];
  };
}

const websocketCorsOrigins = (
  process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:3000'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

@Injectable()
@WebSocketGateway({
  cors: {
    origin: websocketCorsOrigins,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  /** In-memory presence map: userId -> status string */
  private readonly presenceMap = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token: string | undefined =
        socket.handshake.auth?.token ??
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(
          `[ws] Rejected unauthenticated connection ${socket.id}`,
        );
        socket.disconnect();
        return;
      }

      const secret = this.configService.get<string>('jwt.secret') ?? '';
      const payload = this.jwtService.verify<{
        sub: string;
        organizationId: string;
      }>(token, { secret });

      // Find all mailboxes this user has access to
      const accesses = await this.prisma.mailboxAccess.findMany({
        where: { userId: payload.sub },
        select: { mailboxId: true },
      });
      const mailboxIds = accesses.map((a) => a.mailboxId);

      // Attach user info to socket
      const s = socket as AuthenticatedSocket;
      s.data = {
        userId: payload.sub,
        organizationId: payload.organizationId,
        mailboxIds,
      };

      // Join rooms
      await s.join(`user:${payload.sub}`);
      await s.join(`org:${payload.organizationId}`);
      for (const mailboxId of mailboxIds) {
        await s.join(`mailbox:${mailboxId}`);
      }

      // Emit presence snapshot to the new joiner
      const snapshot: Record<string, string> = {};
      for (const mailboxId of mailboxIds) {
        // Get all sockets in the mailbox room and their presence
        const roomSockets = await this.server
          .in(`mailbox:${mailboxId}`)
          .fetchSockets();
        for (const rs of roomSockets) {
          const rData = (rs as unknown as AuthenticatedSocket).data;
          if (rData?.userId && this.presenceMap.has(rData.userId)) {
            snapshot[rData.userId] = this.presenceMap.get(rData.userId)!;
          }
        }
      }
      s.emit('presence:snapshot', snapshot);

      this.logger.log(`[ws] Connected user=${payload.sub} socket=${socket.id}`);
    } catch {
      this.logger.warn(`[ws] Rejected socket ${socket.id} — invalid JWT`);
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket): void {
    const s = socket as AuthenticatedSocket;
    if (s.data?.userId) {
      this.presenceMap.delete(s.data.userId);
      this.logger.log(`[ws] Disconnected user=${s.data.userId}`);
    }
  }

  // -------------------------------------------------------------------------
  // Client → server events
  // -------------------------------------------------------------------------

  @SubscribeMessage('presence:state')
  handlePresenceState(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { status: string },
  ): void {
    const s = socket as AuthenticatedSocket;
    if (!s.data?.userId) return;

    this.presenceMap.set(s.data.userId, data.status);

    // Broadcast to all mailbox rooms this user belongs to
    for (const mailboxId of s.data.mailboxIds) {
      this.server.to(`mailbox:${mailboxId}`).emit('presence:changed', {
        userId: s.data.userId,
        status: data.status,
      });
    }
  }

  @SubscribeMessage('typing:subscribe')
  async handleTypingSubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { threadId: string },
  ): Promise<void> {
    await socket.join(`thread:${data.threadId}`);
  }

  @SubscribeMessage('typing:start')
  handleTypingStart(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { threadId: string },
  ): void {
    const s = socket as AuthenticatedSocket;
    this.server.to(`thread:${data.threadId}`).emit('typing:changed', {
      userId: s.data?.userId,
      threadId: data.threadId,
      typing: true,
    });
  }

  @SubscribeMessage('typing:stop')
  handleTypingStop(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { threadId: string },
  ): void {
    const s = socket as AuthenticatedSocket;
    this.server.to(`thread:${data.threadId}`).emit('typing:changed', {
      userId: s.data?.userId,
      threadId: data.threadId,
      typing: false,
    });
  }

  // -------------------------------------------------------------------------
  // Server → client helpers
  // -------------------------------------------------------------------------

  /** Emit an event to a specific user's room. */
  emitToUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  /** Broadcast a thread-level event only to users who have mailbox access. */
  async emitToMailbox(
    mailboxId: string,
    event: string,
    data: unknown,
  ): Promise<void> {
    this.server.to(`mailbox:${mailboxId}`).emit(event, data);
  }

  /** Broadcast an event to all members in an organization room. */
  emitToOrganization(
    organizationId: string,
    event: string,
    data: unknown,
  ): void {
    this.server.to(`org:${organizationId}`).emit(event, data);
  }
}
