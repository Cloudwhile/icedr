import type { Request } from 'express';

type AuditSession = {
  user: {
    avatarUrl?: string | null;
    displayName?: string | null;
    email?: string | null;
    id?: string | null;
  };
};

export function createRequestAuditMetadata(
  session?: AuditSession | null,
  request?: Request,
) {
  return removeEmptyAuditValues({
    actorAvatarUrl: session?.user.avatarUrl,
    actorDisplayName: session?.user.displayName,
    actorEmail: session?.user.email,
    actorName:
      session?.user.displayName || session?.user.email || session?.user.id,
    actorUserId: session?.user.id,
    ip: getRequestIp(request),
    userAgent: request?.get('user-agent'),
  });
}

export function createVisitorAuditMetadata(request?: Request) {
  return removeEmptyAuditValues({
    ip: getRequestIp(request),
    userAgent: request?.get('user-agent'),
  });
}

function getRequestIp(request?: Request) {
  if (!request) return undefined;
  const forwardedFor = request.get('x-forwarded-for');
  const forwardedIp = forwardedFor
    ?.split(',')
    .map((value) => value.trim())
    .find(Boolean);
  return (
    forwardedIp ||
    request.get('x-real-ip') ||
    request.ip ||
    request.socket.remoteAddress ||
    undefined
  );
}

function removeEmptyAuditValues(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (typeof value === 'string') return value.trim().length > 0;
      return value !== null && value !== undefined;
    }),
  );
}
