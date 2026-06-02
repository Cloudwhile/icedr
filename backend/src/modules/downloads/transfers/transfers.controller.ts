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
      limit: limit ? Number(limit) : undefined,
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
