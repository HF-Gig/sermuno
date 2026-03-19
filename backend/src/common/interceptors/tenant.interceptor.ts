import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { JwtUser } from '../decorators/current-user.decorator';

interface AuthenticatedRequest extends Request {
  user?: JwtUser;
  organizationId?: string;
}

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.organizationId) {
      request.organizationId = request.user.organizationId;
    }
    return next.handle();
  }
}
