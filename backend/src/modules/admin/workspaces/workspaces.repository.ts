import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { Workspace } from '../../../generated/prisma/client';

export type WorkspaceResponse = {
  id: string;
  name: string;
  rootNodeId: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class WorkspacesRepository implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.prisma.workspace.upsert({
      where: { id: 'workspace-default' },
      update: {},
      create: {
        id: 'workspace-default',
        name: 'Default Workspace',
        rootNodeId: 'node-root',
        memberCount: 1,
      },
    });
  }

  async list() {
    const rows = await this.prisma.workspace.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: Workspace): WorkspaceResponse {
    return {
      id: row.id,
      name: row.name,
      rootNodeId: row.rootNodeId,
      memberCount: row.memberCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
