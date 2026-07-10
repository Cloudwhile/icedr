import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { createRequestAuditMetadata } from '../../../common/security/audit-metadata';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import {
  type PublicTransferResponse,
  type TransferResponse,
  UpdateTransferDto,
} from './transfers.dto';
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
    const session = await this.adminGuard.requirePermission(
      authorization,
      'transfer',
      'read',
    );
    const transfers = await this.transfersService.listTransfers(
      {
        workspaceId,
        limit: parseLimit(limit),
      },
      this.getTransferAccess(session),
    );
    return transfers.map(toPublicTransfer);
  }

  @Patch(':id')
  async updateTransfer(
    @Param('id') id: string,
    @Body() dto: UpdateTransferDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'transfer',
      'write',
    );
    return toPublicTransfer(
      await this.transfersService.updateTransfer(
        id,
        {
          ...dto,
          auditMetadata: createRequestAuditMetadata(session, request),
        },
        this.getTransferAccess(session),
      ),
    );
  }

  @Delete(':id')
  async deleteTransfer(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'transfer',
      'delete',
    );
    return this.transfersService.deleteTransfer(
      id,
      createRequestAuditMetadata(session, request),
      this.getTransferAccess(session),
    );
  }

  private getTransferAccess(
    session: Awaited<ReturnType<AdminGuardService['requireSession']>>,
  ) {
    return {
      actorRole: session.user.role,
      actorUserId: session.user.id,
    };
  }
}

function toPublicTransfer(transfer: TransferResponse): PublicTransferResponse {
  const { objectKey, ownerUserId, ...publicTransfer } = transfer;
  void ownerUserId;
  return {
    ...publicTransfer,
    hasContent: Boolean(objectKey),
  };
}

function parseLimit(limit?: string) {
  const normalized = limit?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
