import {
  Body,
  Controller,
  Delete,
  Get,
  Head,
  Param,
  Post,
  Query,
  Res,
  Headers,
  HttpException,
  HttpStatus,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuditActor } from '../logs/audit-events';
import {
  createRequestAuditMetadata,
  createVisitorAuditMetadata,
} from '../../common/security/audit-metadata';
import { AdminGuardService } from '../../common/security/admin-guard.service';
import {
  applyDownloadErrorHeaders,
  writeDownloadResponse,
} from '../../common/http/download-response';
import type { AuthUserResponse } from '../auth/core/auth.dto';
import {
  SendShareEmailCodeDto,
  VerifyShareEmailCodeDto,
} from './share-access.dto';
import { CreateShareDownloadIntentDto, CreateShareDto } from './shares.dto';
import { SharesService } from './shares.service';

@ApiTags('shares')
@Controller('shares')
export class SharesController {
  constructor(
    private readonly sharesService: SharesService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Post()
  async createShare(
    @Body() dto: CreateShareDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'share',
      'write',
    );
    return this.sharesService.createShare(
      dto,
      createRequestAuditMetadata(session, request),
      {
        actorRole: session.user.role,
        actorUserId: session.user.id,
      },
    );
  }

  @Get()
  async listShares(
    @Query('workspaceId') workspaceId?: string,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'share',
      'read',
    );
    return this.sharesService.listShares(workspaceId, {
      actorRole: session.user.role,
      actorUserId: session.user.id,
    });
  }

  @Get(':token/management')
  async getManagedShare(
    @Param('token') token: string,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'share',
      'read',
    );
    return this.sharesService.getManagedShare(token, {
      actorRole: session.user.role,
      actorUserId: session.user.id,
    });
  }

  @Get(':token')
  async getShare(
    @Param('token') token: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-share-access-session') accessSessionId: string | undefined,
    @Req() request: Request,
  ) {
    const audit = await this.resolveShareRequestAudit(authorization, request);
    return this.sharesService.getShare(token, audit.metadata, {
      actor: audit.actor,
      accessSessionId,
      accountUser: audit.user,
    });
  }

  @Delete(':token')
  async revokeShare(
    @Param('token') token: string,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requireAdminSession(authorization);
    return this.sharesService.revokeShare(
      token,
      createRequestAuditMetadata(session, request),
    );
  }

  @Post(':token/access-sessions/email-code')
  sendEmailAccessCode(
    @Param('token') token: string,
    @Body() dto: SendShareEmailCodeDto,
    @Req() request: Request,
  ) {
    return this.sharesService.sendEmailAccessCode(
      token,
      dto,
      createVisitorAuditMetadata(request),
    );
  }

  @Post(':token/access-sessions/verify-email')
  verifyEmailAccessCode(
    @Param('token') token: string,
    @Body() dto: VerifyShareEmailCodeDto,
    @Req() request: Request,
  ) {
    return this.sharesService.verifyEmailAccessCode(
      token,
      dto,
      createVisitorAuditMetadata(request),
    );
  }

  @Post(':token/access-sessions/account')
  async createAccountAccessSession(
    @Param('token') token: string,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: Request,
  ) {
    const session = await this.adminGuard.requireSession(authorization);
    return this.sharesService.createVerifiedAccountAccessSession(
      token,
      session.user,
      createRequestAuditMetadata(session, request),
    );
  }

  @Post(':token/items/:nodeId/download-intents')
  async createDownloadIntent(
    @Param('token') token: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: CreateShareDownloadIntentDto,
    @Headers('x-share-access-session') accessSessionId?: string,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const audit = await this.resolveShareRequestAudit(authorization, request);
    return this.sharesService.createDownloadIntent(
      token,
      nodeId,
      accessSessionId,
      audit.metadata,
      audit.user,
      dto.purpose ?? 'download',
    );
  }

  @Get(':token/items/:nodeId/download')
  async downloadSharedNode(
    @Param('token') token: string,
    @Param('nodeId') nodeId: string,
    @Query('downloadId') downloadId: string,
    @Headers('range') range: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const download = await this.sharesService.downloadSharedNode(
        token,
        nodeId,
        downloadId,
        createVisitorAuditMetadata(request),
        { range },
      );
      return writeDownloadResponse(download, request, response);
    } catch (error) {
      applyDownloadErrorHeaders(error, response);
      throw error;
    }
  }

  @Head(':token/items/:nodeId/download')
  rejectDownloadHead(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Allow', 'GET');
    throw new HttpException(
      'HEAD is not supported for download capabilities',
      HttpStatus.METHOD_NOT_ALLOWED,
    );
  }

  @Post(':token/items/:nodeId/preview-intents')
  async createPreviewIntent(
    @Param('token') token: string,
    @Param('nodeId') nodeId: string,
    @Headers('x-share-access-session') accessSessionId?: string,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const audit = await this.resolveShareRequestAudit(authorization, request);
    return this.sharesService.createPreviewIntent(
      token,
      nodeId,
      accessSessionId,
      audit.metadata,
      audit.user,
    );
  }

  @Get(':token/items/:nodeId/preview/status')
  async getPreviewStatus(
    @Param('token') token: string,
    @Param('nodeId') nodeId: string,
    @Query('previewId') previewId: string,
    @Headers('x-share-access-session') accessSessionId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: Request,
  ) {
    const audit = await this.resolveShareRequestAudit(authorization, request);
    return this.sharesService.getPreviewStatus(
      token,
      nodeId,
      previewId,
      accessSessionId,
      audit.metadata,
      audit.user,
    );
  }

  private async resolveShareRequestAudit(
    authorization: string | undefined,
    request?: Request,
  ): Promise<{
    actor: AuditActor;
    metadata: Record<string, unknown>;
    user?: AuthUserResponse;
  }> {
    if (!authorization) {
      return {
        actor: 'visitor',
        metadata: createVisitorAuditMetadata(request),
      };
    }

    try {
      const session = await this.adminGuard.requireSession(authorization);
      return {
        actor: 'account',
        metadata: createRequestAuditMetadata(session, request),
        user: session.user,
      };
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      return {
        actor: 'visitor',
        metadata: createVisitorAuditMetadata(request),
      };
    }
  }
}
