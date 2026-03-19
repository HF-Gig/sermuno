import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { JwtUser } from '../decorators/current-user.decorator';
import { Prisma } from '@prisma/client';

export interface AuditLogMeta {
  action: string;
  entityType: string;
  entityId?: string;
  previousValue?: Record<string, unknown>;
}

interface AuthenticatedRequest extends Request {
  user?: JwtUser;
  organizationId?: string;
  auditMeta?: AuditLogMeta;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    return next.handle().pipe(
      tap(async (responseData: unknown) => {
        if (!request.auditMeta || !request.user?.organizationId) {
          return;
        }

        const meta = request.auditMeta;
        const user = request.user;
        const entityId =
          meta.entityId ?? (responseData as { id?: string } | null)?.id;

        await this.prisma.auditLog.create({
          data: {
            organizationId: user.organizationId,
            userId: user.sub,
            action: meta.action,
            entityType: meta.entityType,
            entityId: entityId ?? null,
            previousValue: meta.previousValue
              ? (meta.previousValue as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            newValue: responseData
              ? (responseData as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            ipAddress: request.ip ?? null,
            userAgent: request.headers['user-agent'] ?? null,
          },
        });
      }),
    );
  }
}
