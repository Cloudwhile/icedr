import {
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AdminGuardService } from '../../common/security/admin-guard.service';
import { RunBlobReconcileDto } from './storage-reconcile.dto';
import { UpdateStorageSettingsDto } from './storage-settings.dto';
import { StorageService } from './storage.service';

@ApiTags('storage')
@Controller('storage')
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Get('profile')
  async getProfile() {
    return this.storageService.getProfile();
  }

  @Get('settings')
  getSettings() {
    return this.storageService.getSettings();
  }

  @Get('usage')
  getUsage(@Query('workspaceId') workspaceId = 'workspace-default') {
    return this.storageService.getUsage(workspaceId);
  }

  @Get('reconcile/tasks')
  async listReconcileTasks(
    @Query('limit') limit?: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.storageService.listReconcileTasks(
      limit ? Number(limit) : undefined,
    );
  }

  @Post('reconcile')
  async reconcileObjects(
    @Body() dto: RunBlobReconcileDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.storageService.reconcileObjects(dto);
  }

  @Patch('settings')
  async updateSettings(
    @Body() dto: UpdateStorageSettingsDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.storageService.updateSettings(dto);
  }

  @Post('settings/test')
  async testSettings(
    @Body() dto: UpdateStorageSettingsDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.storageService.testSettings(dto);
  }

  @Put('local-uploads')
  async uploadLocalObject(
    @Query('objectKey') objectKey: string,
    @Req() request: Request,
  ) {
    return this.storageService.writeLocalUpload(objectKey, request);
  }

  @Get('local-files')
  async downloadLocalObject(
    @Query('objectKey') objectKey: string,
    @Query('filename') filename: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const localFile = await this.storageService.getLocalDownload(
      objectKey,
      filename,
    );
    response.setHeader('Content-Type', localFile.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(localFile.filename)}"`,
    );
    return new StreamableFile(localFile.stream);
  }
}
