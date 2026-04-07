import type { Request } from 'express';

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export function extractRequestMeta(request: Request): RequestMeta {
  const userAgentHeader = request.headers['user-agent'];
  const userAgent = Array.isArray(userAgentHeader)
    ? userAgentHeader[0]
    : userAgentHeader;

  return {
    ipAddress: request.ip,
    userAgent: userAgent ?? undefined,
  };
}
