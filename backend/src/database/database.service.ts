import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(private readonly config: ConfigService) {
    if (!this.config.get<boolean>('database.configured')) {
      throw new Error(
        'DATABASE_HOST, DATABASE_PORT, DATABASE_DBNAME, DATABASE_USER, and DATABASE_PASSWORD are required.',
      );
    }

    this.pool = new Pool({ connectionString: this.getConnectionString() });
  }

  private getConnectionString() {
    const host = this.config.get<string>('database.host') ?? '';
    const port = this.config.get<number>('database.port') ?? 5432;
    const dbName = this.config.get<string>('database.dbName') ?? '';
    const user = encodeURIComponent(
      this.config.get<string>('database.user') ?? '',
    );
    const password = encodeURIComponent(
      this.config.get<string>('database.password') ?? '',
    );
    return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }

  async ping() {
    await this.pool.query('select 1');
    return true;
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }
}
