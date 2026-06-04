import {
  Body,
  Controller,
  Delete,
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
  BatchFileNodeIdsDto,
  BatchMoveFileNodesDto,
  CompleteUploadPartDto,
  CompleteUploadDto,
  CopyFileNodeDto,
  CreateDownloadIntentDto,
  CreateFolderDto,
  CreateUploadIntentDto,
  MoveFileNodeDto,
  RenameFileNodeDto,
  RestoreFileNodeDto,
  SearchFileNodesQueryDto,
  UpdateFilePolicyDto,
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

  private getSessionActor(
    session: Awaited<ReturnType<AdminGuardService['requireSession']>>,
  ) {
    return session.user.displayName || session.user.email || session.user.id;
  }

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

  @Get('search')
  async searchFileNodes(
    @Query() query: SearchFileNodesQueryDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'read');
    return this.fileNodesService.searchFileNodes(query);
  }

  @Get('trash-policy')
  async getTrashPolicy(@Headers('authorization') authorization?: string) {
    await this.adminGuard.requirePermission(authorization, 'settings', 'read');
    return this.fileNodesService.getFilePolicy();
  }

  @Patch('trash-policy')
  async updateTrashPolicy(
    @Body() dto: UpdateFilePolicyDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(
      authorization,
      'settings',
      'manage',
    );
    return this.fileNodesService.updateFilePolicy(dto);
  }

  @Post('trash/cleanup')
  async cleanupTrash(@Headers('authorization') authorization?: string) {
    await this.adminGuard.requirePermission(
      authorization,
      'settings',
      'manage',
    );
    return this.fileNodesService.cleanupTrash();
  }

  @Post('batch/archive')
  async batchArchive(
    @Body() dto: BatchFileNodeIdsDto,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    return this.fileNodesService.batchArchive(dto, {
      actor: this.getSessionActor(session),
    });
  }

  @Post('batch/restore')
  async batchRestore(
    @Body() dto: BatchFileNodeIdsDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.batchRestore(dto);
  }

  @Post('batch/move')
  async batchMove(
    @Body() dto: BatchMoveFileNodesDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.batchMove(dto);
  }

  @Post('batch/download-intents')
  async batchDownloadIntents(
    @Body() dto: BatchFileNodeIdsDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'download');
    return this.fileNodesService.createBatchDownloadIntents(dto);
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
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    return this.fileNodesService.createUploadIntent(dto, {
      ownerUserId: session.user.id,
    });
  }

  @Post('upload-completions')
  async completeUpload(
    @Body() dto: CompleteUploadDto,
    @Headers('authorization') authorization?: string,
    @Headers('x-workspace-actor') workspaceActor?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    return this.fileNodesService.completeUpload(
      {
        ...dto,
        owner: dto.owner ?? workspaceActor,
      },
      { ownerUserId: session.user.id },
    );
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
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    return this.fileNodesService.createFolder({
      ...dto,
      owner: dto.owner ?? workspaceActor,
      ownerUserId: session.user.id,
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
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    return this.fileNodesService.updateFileNodeState(id, dto, {
      actor: this.getSessionActor(session),
    });
  }

  @Post(':id/restore')
  async restoreFileNode(
    @Param('id') id: string,
    @Body() dto: RestoreFileNodeDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.restoreFileNode(id, dto);
  }

  @Delete(':id')
  async permanentlyDeleteFileNode(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.permanentlyDeleteFileNode(id);
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

  @Get(':id/versions')
  async listFileVersions(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'read');
    return this.fileNodesService.listFileVersions(id);
  }

  @Post(':id/versions/:versionId/download-intents')
  async createVersionDownloadIntent(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'download');
    return this.fileNodesService.createVersionDownloadIntent(id, versionId);
  }

  @Post(':id/versions/:versionId/restore')
  async restoreFileVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'file', 'write');
    return this.fileNodesService.restoreFileVersion(id, versionId);
  }
}
