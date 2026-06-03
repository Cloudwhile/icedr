import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AdminGuardService } from '../../common/security/admin-guard.service';
import {
  CompleteUploadPartDto,
  CompleteUploadDto,
  CopyFileNodeDto,
  CreateDownloadIntentDto,
  CreateFolderDto,
  CreateUploadIntentDto,
  MoveFileNodeDto,
  RenameFileNodeDto,
  UpdateFileNodeContentDto,
  UpdateFileNodeStateDto,
} from './file-nodes.dto';
import { FileNodesService } from './file-nodes.service';

@ApiTags('file-nodes')
@Controller('file-nodes')
export class FileNodesController {
  constructor(
    private readonly fileNodesService: FileNodesService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Get()
  async listFileNodes(
    @Headers('authorization') authorization?: string,
    @Query('workspaceId') workspaceId?: string,
    @Query('parentNodeId') parentNodeId?: string,
    @Query('state') state?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'read');
    return this.fileNodesService.listFileNodes(workspaceId, parentNodeId, {
      state,
    });
  }

  @Get(':id')
  async getFileNode(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'read');
    return this.fileNodesService.getFileNode(id);
  }

  @Post('upload-intents')
  async createUploadIntent(
    @Body() dto: CreateUploadIntentDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.createUploadIntent(dto);
  }

  @Post('upload-completions')
  async completeUpload(
    @Body() dto: CompleteUploadDto,
    @Headers('authorization') authorization?: string,
    @Headers('x-workspace-actor') workspaceActor?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.completeUpload({
      ...dto,
      owner: dto.owner ?? workspaceActor,
    });
  }

  @Post('upload-sessions/:sessionId/parts/:partIndex/upload-intents')
  async createUploadPartIntent(
    @Param('sessionId') sessionId: string,
    @Param('partIndex') partIndex: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.createUploadPartIntent(
      sessionId,
      Number(partIndex),
    );
  }

  @Post('upload-sessions/:sessionId/parts/:partIndex/completions')
  async completeUploadPart(
    @Param('sessionId') sessionId: string,
    @Param('partIndex') partIndex: string,
    @Body() dto: CompleteUploadPartDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.completeUploadPart(
      sessionId,
      Number(partIndex),
      dto,
    );
  }

  @Put('upload-sessions/:sessionId/chunks/:partIndex')
  async uploadChunk(
    @Param('sessionId') sessionId: string,
    @Param('partIndex') partIndex: string,
    @Req() request: Request,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.uploadChunk(
      sessionId,
      Number(partIndex),
      request,
    );
  }

  @Post('upload-sessions/:sessionId/cancel')
  async cancelUploadSession(
    @Param('sessionId') sessionId: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.cancelUploadSession(sessionId);
  }

  @Post('folders')
  async createFolder(
    @Body() dto: CreateFolderDto,
    @Headers('authorization') authorization?: string,
    @Headers('x-workspace-actor') workspaceActor?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.createFolder({
      ...dto,
      owner: dto.owner ?? workspaceActor,
    });
  }

  @Patch(':id')
  async renameFileNode(
    @Param('id') id: string,
    @Body() dto: RenameFileNodeDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.renameFileNode(id, dto);
  }

  @Post(':id/move')
  async moveFileNode(
    @Param('id') id: string,
    @Body() dto: MoveFileNodeDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.moveFileNode(id, dto);
  }

  @Post(':id/copy')
  async copyFileNode(
    @Param('id') id: string,
    @Body() dto: CopyFileNodeDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.copyFileNode(id, dto);
  }

  @Get(':id/content')
  async getFileNodeContent(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'read');
    return this.fileNodesService.getFileNodeContent(id);
  }

  @Patch(':id/content')
  async updateFileNodeContent(
    @Param('id') id: string,
    @Body() dto: UpdateFileNodeContentDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.updateFileNodeContent(id, dto);
  }

  @Patch(':id/state')
  async updateFileNodeState(
    @Param('id') id: string,
    @Body() dto: UpdateFileNodeStateDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.updateFileNodeState(id, dto);
  }

  @Post(':id/download-intents')
  async createDownloadIntent(
    @Param('id') id: string,
    @Body() dto: CreateDownloadIntentDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'download');
    return this.fileNodesService.createDownloadIntent(id, dto);
  }

  @Get(':id/download')
  async downloadFileNode(
    @Param('id') id: string,
    @Query('downloadId') downloadId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const download = await this.fileNodesService.downloadFileNode(
      id,
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

  @Post(':id/preview-intents')
  async createPreviewIntent(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'read');
    return this.fileNodesService.createPreviewIntent(id);
  }

  @Get(':id/preview/status')
  getPreviewStatus(
    @Param('id') id: string,
    @Query('previewId') previewId: string,
  ) {
    return this.fileNodesService.getPreviewStatus(id, previewId);
  }
}
