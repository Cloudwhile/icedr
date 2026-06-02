import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UpdateTransferDto } from './transfers.dto';
import { TransfersService } from './transfers.service';

@ApiTags('transfers')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  listTransfers(
    @Query('workspaceId') workspaceId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.transfersService.listTransfers({
      workspaceId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch(':id')
  updateTransfer(@Param('id') id: string, @Body() dto: UpdateTransferDto) {
    return this.transfersService.updateTransfer(id, dto);
  }

  @Delete(':id')
  deleteTransfer(@Param('id') id: string) {
    return this.transfersService.deleteTransfer(id);
  }
}
