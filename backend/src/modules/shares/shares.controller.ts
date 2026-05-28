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
  ) {}

  @Post()
  createShare(@Body() dto: CreateShareDto) {
    return this.sharesService.createShare(dto);
  }

  @Get()
  listShares(@Query('workspaceId') workspaceId?: string) {
    return this.sharesService.listShares(workspaceId);
  }

  @Get(':token')
  getShare(@Param('token') token: string) {
    return this.sharesService.getShare(token);
  }

  @Delete(':token')
  revokeShare(@Param('token') token: string) {
    return this.sharesService.revokeShare(token);
  }

  @Post(':token/access-sessions/email-code')
  sendEmailAccessCode(
    @Param('token') token: string,
    @Body() dto: SendShareEmailCodeDto,
  ) {
    return this.sharesService.sendEmailAccessCode(token, dto);
  }

  @Post(':token/access-sessions/verify-email')
  verifyEmailAccessCode(
    @Param('token') token: string,
    @Body() dto: VerifyShareEmailCodeDto,
  ) {
    return this.sharesService.verifyEmailAccessCode(token, dto);
  }

  @Post(':token/access-sessions/oauth')
  async createOAuthAccessSession(@Param('token') token: string) {
    await this.sharesService.getShare(token);
    return this.authService.startOAuthShareAccess(token);
  }

  @Get(':token/oauth/start')
  async startOAuthAccess(@Param('token') token: string) {
    await this.sharesService.getShare(token);
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
    );
    const redirectTarget = this.authService.buildShareOAuthFrontendCallbackUrl(
      result.shareToken,
      session.sessionId,
    );
    response.redirect(302, redirectTarget);
  }

  @Post(':token/items/:nodeId/download-intents')
  createDownloadIntent(
    @Param('token') token: string,
    @Param('nodeId') nodeId: string,
    @Headers('x-share-access-session') accessSessionId?: string,
  ) {
    return this.sharesService.createDownloadIntent(
      token,
      nodeId,
      accessSessionId,
    );
  }

  @Get(':token/items/:nodeId/download')
  async downloadSharedNode(
    @Param('token') token: string,
    @Param('nodeId') nodeId: string,
    @Query('downloadId') downloadId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const download = await this.sharesService.downloadSharedNode(
      token,
      nodeId,
      downloadId,
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
  createPreviewIntent(
    @Param('token') token: string,
    @Param('nodeId') nodeId: string,
    @Headers('x-share-access-session') accessSessionId?: string,
  ) {
    return this.sharesService.createPreviewIntent(
      token,
      nodeId,
      accessSessionId,
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
}
