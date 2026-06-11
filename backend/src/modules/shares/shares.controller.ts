import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  Headers,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuditActor } from '../logs/audit-events';
import {
  createRequestAuditMetadata,
  createVisitorAuditMetadata,
} from '../../common/security/audit-metadata';
import { AdminGuardService } from '../../common/security/admin-guard.service';
import { AuthService } from '../auth/core/auth.service';
import {
  SendShareEmailCodeDto,
  VerifyShareEmailCodeDto,
} from './share-access.dto';
import { CreateShareDto } from './shares.dto';
import { SharesService } from './shares.service';

@ApiTags('shares')
@Controller('shares')
export class SharesController {
  constructor(
    private readonly sharesService: SharesService,
    private readonly authService: AuthService,
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
    );
  }

  @Get()
  async listShares(
    @Query('workspaceId') workspaceId?: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'share', 'read');
    return this.sharesService.listShares(workspaceId);
  }

  @Get(':token')
  async getShare(
    @Param('token') token: string,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: Request,
  ) {
    const audit = await this.resolveShareRequestAudit(authorization, request);
    return this.sharesService.getShare(token, audit.metadata, {
      actor: audit.actor,
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

  @Post(':token/access-sessions/oauth')
  async createOAuthAccessSession(
    @Param('token') token: string,
    @Req() request: Request,
  ) {
    await this.sharesService.getShare(
      token,
      createVisitorAuditMetadata(request),
    );
    return this.authService.startOAuthShareAccess(token);
  }

  @Get(':token/oauth/start')
  async startOAuthAccess(
    @Param('token') token: string,
    @Req() request: Request,
  ) {
    await this.sharesService.getShare(
      token,
      createVisitorAuditMetadata(request),
    );
    return this.authService.startOAuthShareAccess(token);
  }

  @Get('oauth/callback')
  async oauthCallback(@Req() request: Request, @Res() response: Response) {
    const result = await this.authService.handleOAuthCallback(
      `${request.protocol}://${request.get('host')}${request.originalUrl}`,
    );
    if (result.flow !== 'share' || !result.shareToken) {
      response.redirect(302, '/');
      return;
    }
    const session = await this.sharesService.createVerifiedOAuthAccessSession(
      result.shareToken,
      result.user,
      createRequestAuditMetadata({ user: result.user }, request),
    );
    const redirectTarget = this.authService.buildShareOAuthFrontendCallbackUrl(
      result.shareToken,
      session.sessionId,
    );
    response.redirect(302, redirectTarget);
  }

  @Post(':token/items/:nodeId/download-intents')
  async createDownloadIntent(
    @Param('token') token: string,
    @Param('nodeId') nodeId: string,
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
    );
  }

  @Get(':token/items/:nodeId/download')
  async downloadSharedNode(
    @Param('token') token: string,
    @Param('nodeId') nodeId: string,
    @Query('downloadId') downloadId: string,
    @Query('purpose') purpose: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const download = await this.sharesService.downloadSharedNode(
      token,
      nodeId,
      downloadId,
      createVisitorAuditMetadata(request),
      { auditPurpose: purpose === 'preview' ? 'preview' : 'download' },
    );
    if (download.method === 'presigned-url') {
      response.redirect(302, download.redirectUrl);
      return;
    }

    response.setHeader('Content-Type', download.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(download.filename)}"`,
    );
    return download.content;
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
    );
  }

  @Get(':token/items/:nodeId/preview/status')
  getPreviewStatus(
    @Param('token') token: string,
    @Param('nodeId') nodeId: string,
    @Query('previewId') previewId: string,
  ) {
    return this.sharesService.getPreviewStatus(token, nodeId, previewId);
  }

  private async resolveShareRequestAudit(
    authorization: string | undefined,
    request?: Request,
  ): Promise<{ actor: AuditActor; metadata: Record<string, unknown> }> {
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
      };
    } catch {
      return {
        actor: 'visitor',
        metadata: createVisitorAuditMetadata(request),
      };
    }
  }
}
