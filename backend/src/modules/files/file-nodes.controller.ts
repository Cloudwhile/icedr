import {
  Body,
  Controller,
  Delete,
  Get,
  Head,
  Headers,
  HttpException,
  HttpStatus,
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
  applyDownloadErrorHeaders,
  writeDownloadResponse,
} from '../../common/http/download-response';
import {
  createRequestAuditMetadata,
  createVisitorAuditMetadata,
} from '../../common/security/audit-metadata';
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
import { toPublicFileNode } from './file-node-public-response';
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

  private getFileAccess(
    session: Awaited<ReturnType<AdminGuardService['requireSession']>>,
  ) {
    return {
      actorRole: session.user.role,
      actorUserId: session.user.id,
    };
  }

  @Get()
  async listFileNodes(
    @Headers('authorization') authorization?: string,
    @Query('workspaceId') workspaceId?: string,
    @Query('parentNodeId') parentNodeId?: string,
    @Query('state') state?: string,
    @Query('spaceScope') spaceScope?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'read',
    );
    const nodes = await this.fileNodesService.listFileNodes(
      workspaceId,
      parentNodeId,
      {
        ownerUserId: spaceScope === 'personal' ? session.user.id : undefined,
        spaceScope,
        state,
      },
    );
    return nodes.map(toPublicFileNode);
  }

  @Get('search')
  async searchFileNodes(
    @Query() query: SearchFileNodesQueryDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'read',
    );
    const result = await this.fileNodesService.searchFileNodes(query, {
      auditMetadata: createRequestAuditMetadata(session, request),
      ownerUserId:
        query.spaceScope === 'personal' ? session.user.id : undefined,
    });
    return {
      ...result,
      items: result.items.map(toPublicFileNode),
    };
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
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    const result = await this.fileNodesService.batchArchive(dto, {
      ...this.getFileAccess(session),
      actor: this.getSessionActor(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
    return {
      ...result,
      succeeded: result.succeeded.map(toPublicFileNode),
    };
  }

  @Post('batch/restore')
  async batchRestore(
    @Body() dto: BatchFileNodeIdsDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    const result = await this.fileNodesService.batchRestore(dto, {
      ...this.getFileAccess(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
    return {
      ...result,
      succeeded: result.succeeded.map(toPublicFileNode),
    };
  }

  @Post('batch/move')
  async batchMove(
    @Body() dto: BatchMoveFileNodesDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    const result = await this.fileNodesService.batchMove(dto, {
      ...this.getFileAccess(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
    return {
      ...result,
      succeeded: result.succeeded.map(toPublicFileNode),
    };
  }

  @Post('batch/download-intents')
  async batchDownloadIntents(
    @Body() dto: BatchFileNodeIdsDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'download',
    );
    return this.fileNodesService.createBatchDownloadIntents(dto, {
      ...this.getFileAccess(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
  }

  @Get('upload-sessions/:sessionId')
  async getUploadSession(
    @Param('sessionId') sessionId: string,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'read',
    );
    return this.fileNodesService.getUploadSession(sessionId, session.user.id);
  }

  @Get(':id')
  async getFileNode(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'read',
    );
    const node = await this.fileNodesService.getFileNode(
      id,
      this.getFileAccess(session),
    );
    return node ? toPublicFileNode(node) : null;
  }

  @Post('upload-intents')
  async createUploadIntent(
    @Body() dto: CreateUploadIntentDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    return this.fileNodesService.createUploadIntent(dto, {
      actorRole: session.user.role,
      auditMetadata: createRequestAuditMetadata(session, request),
      ownerUserId: session.user.id,
    });
  }

  @Post('upload-completions')
  async completeUpload(
    @Body() dto: CompleteUploadDto,
    @Headers('authorization') authorization?: string,
    @Headers('x-workspace-actor') workspaceActor?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    const node = await this.fileNodesService.completeUpload(
      {
        ...dto,
        owner: dto.owner ?? workspaceActor,
      },
      {
        actorRole: session.user.role,
        auditMetadata: createRequestAuditMetadata(session, request),
        ownerUserId: session.user.id,
      },
    );
    return toPublicFileNode(node);
  }

  @Post('upload-sessions/:sessionId/parts/:partIndex/upload-intents')
  async createUploadPartIntent(
    @Param('sessionId') sessionId: string,
    @Param('partIndex') partIndex: string,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    return this.fileNodesService.createUploadPartIntent(
      sessionId,
      Number(partIndex),
      session.user.id,
    );
  }

  @Post('upload-sessions/:sessionId/parts/:partIndex/completions')
  async completeUploadPart(
    @Param('sessionId') sessionId: string,
    @Param('partIndex') partIndex: string,
    @Body() dto: CompleteUploadPartDto,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    return this.fileNodesService.completeUploadPart(
      sessionId,
      Number(partIndex),
      dto,
      session.user.id,
    );
  }

  @Put('upload-sessions/:sessionId/chunks/:partIndex')
  async uploadChunk(
    @Param('sessionId') sessionId: string,
    @Param('partIndex') partIndex: string,
    @Req() request: Request,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    return this.fileNodesService.uploadChunk(
      sessionId,
      Number(partIndex),
      request,
      session.user.id,
    );
  }

  @Post('upload-sessions/:sessionId/cancel')
  async cancelUploadSession(
    @Param('sessionId') sessionId: string,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    return this.fileNodesService.cancelUploadSession(sessionId, {
      auditMetadata: createRequestAuditMetadata(session, request),
      ownerUserId: session.user.id,
    });
  }

  @Post('folders')
  async createFolder(
    @Body() dto: CreateFolderDto,
    @Headers('authorization') authorization?: string,
    @Headers('x-workspace-actor') workspaceActor?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    const node = await this.fileNodesService.createFolder({
      ...dto,
      ...this.getFileAccess(session),
      owner: dto.owner ?? workspaceActor,
      auditMetadata: createRequestAuditMetadata(session, request),
      ownerUserId: session.user.id,
    });
    return toPublicFileNode(node);
  }

  @Patch(':id')
  async renameFileNode(
    @Param('id') id: string,
    @Body() dto: RenameFileNodeDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    const node = await this.fileNodesService.renameFileNode(id, dto, {
      ...this.getFileAccess(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
    return toPublicFileNode(node);
  }

  @Post(':id/move')
  async moveFileNode(
    @Param('id') id: string,
    @Body() dto: MoveFileNodeDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    const node = await this.fileNodesService.moveFileNode(id, dto, {
      ...this.getFileAccess(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
    return toPublicFileNode(node);
  }

  @Post(':id/copy')
  async copyFileNode(
    @Param('id') id: string,
    @Body() dto: CopyFileNodeDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    const node = await this.fileNodesService.copyFileNode(id, dto, {
      ...this.getFileAccess(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
    return toPublicFileNode(node);
  }

  @Get(':id/content')
  async getFileNodeContent(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'read',
    );
    return this.fileNodesService.getFileNodeContent(
      id,
      this.getFileAccess(session),
    );
  }

  @Patch(':id/content')
  async updateFileNodeContent(
    @Param('id') id: string,
    @Body() dto: UpdateFileNodeContentDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    return this.fileNodesService.updateFileNodeContent(id, dto, {
      ...this.getFileAccess(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
  }

  @Patch(':id/state')
  async updateFileNodeState(
    @Param('id') id: string,
    @Body() dto: UpdateFileNodeStateDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    const node = await this.fileNodesService.updateFileNodeState(id, dto, {
      ...this.getFileAccess(session),
      actor: this.getSessionActor(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
    return toPublicFileNode(node);
  }

  @Post(':id/restore')
  async restoreFileNode(
    @Param('id') id: string,
    @Body() dto: RestoreFileNodeDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    const node = await this.fileNodesService.restoreFileNode(id, dto, {
      ...this.getFileAccess(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
    return toPublicFileNode(node);
  }

  @Delete(':id')
  async permanentlyDeleteFileNode(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    return this.fileNodesService.permanentlyDeleteFileNode(id, {
      ...this.getFileAccess(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
  }

  @Post(':id/download-intents')
  async createDownloadIntent(
    @Param('id') id: string,
    @Body() dto: CreateDownloadIntentDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'download',
    );
    return this.fileNodesService.createDownloadIntent(id, dto, {
      ...this.getFileAccess(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
  }

  @Get(':id/download')
  async downloadFileNode(
    @Param('id') id: string,
    @Query('downloadId') downloadId: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    try {
      const download = await this.fileNodesService.downloadFileNode(
        id,
        downloadId,
        {
          auditMetadata: createVisitorAuditMetadata(request),
          range,
        },
      );
      return writeDownloadResponse(download, request, response);
    } catch (error) {
      applyDownloadErrorHeaders(error, response);
      throw error;
    }
  }

  @Head(':id/download')
  rejectDownloadHead(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Allow', 'GET');
    throw new HttpException(
      'HEAD is not supported for download capabilities',
      HttpStatus.METHOD_NOT_ALLOWED,
    );
  }

  @Post(':id/preview-intents')
  async createPreviewIntent(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'read',
    );
    return this.fileNodesService.createPreviewIntent(id, {
      ...this.getFileAccess(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
  }

  @Get(':id/preview/status')
  async getPreviewStatus(
    @Param('id') id: string,
    @Query('previewId') previewId: string,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'read',
    );
    return this.fileNodesService.getPreviewStatus(
      id,
      previewId,
      this.getFileAccess(session),
    );
  }

  @Get(':id/versions')
  async listFileVersions(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'read',
    );
    return this.fileNodesService.listFileVersions(
      id,
      this.getFileAccess(session),
    );
  }

  @Post(':id/versions/:versionId/download-intents')
  async createVersionDownloadIntent(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'download',
    );
    return this.fileNodesService.createVersionDownloadIntent(id, versionId, {
      ...this.getFileAccess(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
  }

  @Get(':id/versions/:versionId/download')
  async downloadFileVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Query('downloadId') downloadId: string,
    @Headers('range') range: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const download = await this.fileNodesService.downloadFileVersion(
        id,
        versionId,
        downloadId,
        {
          auditMetadata: createVisitorAuditMetadata(request),
          range,
        },
      );
      return writeDownloadResponse(download, request, response);
    } catch (error) {
      applyDownloadErrorHeaders(error, response);
      throw error;
    }
  }

  @Head(':id/versions/:versionId/download')
  rejectVersionDownloadHead(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Allow', 'GET');
    throw new HttpException(
      'HEAD is not supported for download capabilities',
      HttpStatus.METHOD_NOT_ALLOWED,
    );
  }

  @Post(':id/versions/:versionId/restore')
  async restoreFileVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'file',
      'write',
    );
    const node = await this.fileNodesService.restoreFileVersion(id, versionId, {
      ...this.getFileAccess(session),
      actor: this.getSessionActor(session),
      auditMetadata: createRequestAuditMetadata(session, request),
    });
    return toPublicFileNode(node);
  }
}
