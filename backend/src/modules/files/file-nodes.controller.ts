import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
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
  constructor(private readonly fileNodesService: FileNodesService) {}

  @Get()
  listFileNodes(
    @Query('workspaceId') workspaceId?: string,
    @Query('parentNodeId') parentNodeId?: string,
    @Query('state') state?: string,
  ) {
    return this.fileNodesService.listFileNodes(workspaceId, parentNodeId, {
      state,
    });
  }

  @Get(':id')
  getFileNode(@Param('id') id: string) {
    return this.fileNodesService.getFileNode(id);
  }

  @Post('upload-intents')
  createUploadIntent(@Body() dto: CreateUploadIntentDto) {
    return this.fileNodesService.createUploadIntent(dto);
  }

  @Post('upload-completions')
  completeUpload(
    @Body() dto: CompleteUploadDto,
    @Headers('x-workspace-actor') workspaceActor?: string,
  ) {
    return this.fileNodesService.completeUpload({
      ...dto,
      owner: dto.owner ?? workspaceActor,
    });
  }

  @Post('folders')
  createFolder(
    @Body() dto: CreateFolderDto,
    @Headers('x-workspace-actor') workspaceActor?: string,
  ) {
    return this.fileNodesService.createFolder({
      ...dto,
      owner: dto.owner ?? workspaceActor,
    });
  }

  @Patch(':id')
  renameFileNode(@Param('id') id: string, @Body() dto: RenameFileNodeDto) {
    return this.fileNodesService.renameFileNode(id, dto);
  }

  @Post(':id/move')
  moveFileNode(@Param('id') id: string, @Body() dto: MoveFileNodeDto) {
    return this.fileNodesService.moveFileNode(id, dto);
  }

  @Post(':id/copy')
  copyFileNode(@Param('id') id: string, @Body() dto: CopyFileNodeDto) {
    return this.fileNodesService.copyFileNode(id, dto);
  }

  @Get(':id/content')
  getFileNodeContent(@Param('id') id: string) {
    return this.fileNodesService.getFileNodeContent(id);
  }

  @Patch(':id/content')
  updateFileNodeContent(
    @Param('id') id: string,
    @Body() dto: UpdateFileNodeContentDto,
  ) {
    return this.fileNodesService.updateFileNodeContent(id, dto);
  }

  @Patch(':id/state')
  updateFileNodeState(
    @Param('id') id: string,
    @Body() dto: UpdateFileNodeStateDto,
  ) {
    return this.fileNodesService.updateFileNodeState(id, dto);
  }

  @Post(':id/download-intents')
  createDownloadIntent(
    @Param('id') id: string,
    @Body() dto: CreateDownloadIntentDto,
  ) {
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
  createPreviewIntent(@Param('id') id: string) {
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
