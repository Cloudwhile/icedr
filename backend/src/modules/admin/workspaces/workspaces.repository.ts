import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';

export type WorkspaceResponse = {
  id: string;
  name: string;
  rootNodeId: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

type WorkspaceRow = {
  id: string;
  name: string;
  root_node_id: string;
  member_count: number;
  created_at: Date | string;
  updated_at: Date | string;
};

@Injectable()
export class WorkspacesRepository implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.database.query(`
      create table if not exists workspaces (
        id text primary key,
        name text not null,
        root_node_id text not null,
        member_count integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);

    await this.database.query(
      `
        insert into workspaces (
          id,
          name,
          root_node_id,
          member_count
        )
        values ($1, $2, $3, $4)
        on conflict (id) do nothing
      `,
      ['workspace-default', 'Default Workspace', 'node-root', 1],
    );
  }

  async list() {
    const result = await this.database.query<WorkspaceRow>(
      'select * from workspaces order by created_at asc',
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: WorkspaceRow): WorkspaceResponse {
    return {
      id: row.id,
      name: row.name,
      rootNodeId: row.root_node_id,
      memberCount: row.member_count,
      createdAt: this.toIsoString(row.created_at),
      updatedAt: this.toIsoString(row.updated_at),
    };
  }

  private toIsoString(value: Date | string) {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }
}
