import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import { UpdateTransferDto } from './transfers.dto';
import { TransfersService } from './transfers.service';

@ApiTags('transfers')
@Controller('transfers')
export class TransfersController {
  constructor(
    private readonly transfersService: TransfersService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Get()
  async listTransfers(
    @Headers('authorization') authorization?: string,
    @Query('workspaceId') workspaceId?: string,
    @Query('limit') limit?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'transfer', 'read');
    return this.transfersService.listTransfers({
      workspaceId,
      limit: parseLimit(limit),
    });
  }

  @Patch(':id')
  async updateTransfer(
    @Param('id') id: string,
    @Body() dto: UpdateTransferDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'transfer', 'write');
    return this.transfersService.updateTransfer(id, dto);
  }

  @Delete(':id')
  async deleteTransfer(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(
      authorization,
      'transfer',
      'delete',
    );
    return this.transfersService.deleteTransfer(id);
  }
}

function parseLimit(limit?: string) {
  const normalized = limit?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
