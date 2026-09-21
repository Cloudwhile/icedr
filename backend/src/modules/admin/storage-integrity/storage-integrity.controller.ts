import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import {
  CreateStorageIntegrityTaskDto,
  ListStorageIntegrityResultsQueryDto,
  ListStorageIntegrityTasksQueryDto,
  ListStorageIntegrityTargetsQueryDto,
  RetryStorageIntegrityTaskDto,
  StorageIntegritySummaryQueryDto,
  StorageIntegrityTargetVersionsQueryDto,
} from '../../storage/storage-integrity-task.dto';
import { StorageIntegrityTaskService } from '../../storage/storage-integrity-task.service';
import { StorageIntegrityAcknowledgementService } from '../../storage/storage-integrity-acknowledgement.service';

@ApiTags('admin-storage-integrity')
@Controller('admin/storage-integrity')
export class StorageIntegrityController {
  constructor(
    private readonly tasks: StorageIntegrityTaskService,
    private readonly acknowledgements: StorageIntegrityAcknowledgementService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Post('results/:resultId/acknowledge')
  async acknowledgeResult(
    @Param('resultId') resultId: string,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'storage',
      'manage',
    );
    return this.acknowledgements.acknowledgeResult(resultId, session.user.id);
  }

  @Post('tasks')
  async createTask(
    @Body() dto: CreateStorageIntegrityTaskDto,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'storage',
      'manage',
    );
    return this.tasks.createTask(dto, session.user.id);
  }

  @Get('tasks')
  async listTasks(
    @Query() query: ListStorageIntegrityTasksQueryDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'storage', 'manage');
    return this.tasks.listTasks(query);
  }

  @Get('tasks/:taskId')
  async getTask(
    @Param('taskId') taskId: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'storage', 'manage');
    return this.tasks.getTask(taskId);
  }

  @Get('tasks/:taskId/results')
  async listResults(
    @Param('taskId') taskId: string,
    @Query() query: ListStorageIntegrityResultsQueryDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'storage', 'manage');
    return this.tasks.listResults({
      limit: query.limit,
      offset: query.offset,
      status: query.status === 'all' ? undefined : query.status,
      taskId,
    });
  }

  @Post('tasks/:taskId/retry')
  async retryTask(
    @Param('taskId') taskId: string,
    @Body() dto: RetryStorageIntegrityTaskDto,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'storage',
      'manage',
    );
    return this.tasks.retryTask(taskId, dto.resultIds, session.user.id);
  }

  @Get('summary')
  async getSummary(
    @Query() query: StorageIntegritySummaryQueryDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'storage', 'manage');
    return this.tasks.getSummary(query.scope, query.workspaceId);
  }

  @Get('targets')
  async listTargets(
    @Query() query: ListStorageIntegrityTargetsQueryDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'storage', 'manage');
    return this.tasks.listTargets(query);
  }

  @Get('targets/:nodeId/versions')
  async listTargetVersions(
    @Param('nodeId') nodeId: string,
    @Query() query: StorageIntegrityTargetVersionsQueryDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'storage', 'manage');
    return this.tasks.listTargetVersions(nodeId, query.workspaceId);
  }
}
