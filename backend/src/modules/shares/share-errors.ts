import {
  ForbiddenException,
  GoneException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

export const SHARE_ERROR_CODES = {
  NOT_FOUND: 'SHARE_NOT_FOUND',
  REVOKED: 'SHARE_REVOKED',
  EXPIRED: 'SHARE_EXPIRED',
  VIEW_LIMIT_REACHED: 'SHARE_VIEW_LIMIT_REACHED',
  DOWNLOAD_LIMIT_REACHED: 'SHARE_DOWNLOAD_LIMIT_REACHED',
  ACCESS_SESSION_REQUIRED: 'SHARE_ACCESS_SESSION_REQUIRED',
  ACCESS_SESSION_INVALID: 'SHARE_ACCESS_SESSION_INVALID',
  ACCESS_WAITING: 'SHARE_ACCESS_WAITING',
  DOWNLOAD_DISABLED: 'SHARE_DOWNLOAD_DISABLED',
  PREVIEW_DISABLED: 'SHARE_PREVIEW_DISABLED',
} as const;

export type ShareErrorCode =
  (typeof SHARE_ERROR_CODES)[keyof typeof SHARE_ERROR_CODES];

const SHARE_ERRORS: Record<
  ShareErrorCode,
  { message: string; status: HttpStatus }
> = {
  SHARE_NOT_FOUND: {
    message: 'Share link not found',
    status: HttpStatus.NOT_FOUND,
  },
  SHARE_REVOKED: {
    message: 'Share link is revoked',
    status: HttpStatus.GONE,
  },
  SHARE_EXPIRED: {
    message: 'Share link is expired',
    status: HttpStatus.GONE,
  },
  SHARE_VIEW_LIMIT_REACHED: {
    message: 'Share view limit has been reached',
    status: HttpStatus.GONE,
  },
  SHARE_DOWNLOAD_LIMIT_REACHED: {
    message: 'Share download limit has been reached',
    status: HttpStatus.GONE,
  },
  SHARE_ACCESS_SESSION_REQUIRED: {
    message: 'Share access session is required',
    status: HttpStatus.FORBIDDEN,
  },
  SHARE_ACCESS_SESSION_INVALID: {
    message: 'Share access session is invalid',
    status: HttpStatus.FORBIDDEN,
  },
  SHARE_ACCESS_WAITING: {
    message: 'Share access wait time has not elapsed',
    status: HttpStatus.FORBIDDEN,
  },
  SHARE_DOWNLOAD_DISABLED: {
    message: 'Downloads are disabled for this share',
    status: HttpStatus.FORBIDDEN,
  },
  SHARE_PREVIEW_DISABLED: {
    message: 'Preview is disabled for this share',
    status: HttpStatus.FORBIDDEN,
  },
};

export function createShareError(code: ShareErrorCode) {
  const error = SHARE_ERRORS[code];
  const errorLabel =
    error.status === HttpStatus.NOT_FOUND
      ? 'Not Found'
      : error.status === HttpStatus.GONE
        ? 'Gone'
        : 'Forbidden';
  const response = {
    code,
    error: errorLabel,
    message: error.message,
    statusCode: error.status,
  };

  if (error.status === HttpStatus.NOT_FOUND) {
    return new NotFoundException(response);
  }
  if (error.status === HttpStatus.GONE) {
    return new GoneException(response);
  }
  return new ForbiddenException(response);
}
