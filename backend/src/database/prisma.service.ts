import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaClient as SqlitePrismaClient } from '../generated/prisma-sqlite/client';
import {
  ActiveDatabaseSource,
  PostgresDatabaseSource,
  buildPostgresUrl,
  persistDatabaseSource,
  resolveDatabaseSource,
  toPostgresDatabaseSource,
  type RemoteDatabaseInput,
} from './database-url';

type ActivePrismaClient = PrismaClient | SqlitePrismaClient;

const copyModels = [
  'authSetting',
  'user',
  'userMeta',
  'userIdentity',
  'authSession',
  'authPasswordReset',
  'authPasskey',
  'authChallenge',
  'authOAuthState',
  'authOAuthExchangeCode',
  'setting',
  'workspace',
  'filePolicySetting',
  'workspaceShareSetting',
  'storageSetting',
  'fileNode',
  'fileVersion',
  'previewArtifact',
  'fileDownloadIntent',
  'uploadSession',
  'uploadSessionPart',
  'transferTask',
  'shareLink',
  'shareEmailCode',
  'shareAccessSession',
  'shareDownloadIntent',
  'auditEvent',
  'blobReconcileTask',
] as const;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly backendRoot = resolve(__dirname, '..', '..');
  private activeClient: ActivePrismaClient;
  private activeSource: ActiveDatabaseSource;

  constructor(private readonly config: ConfigService) {
    this.activeSource = resolveDatabaseSource(config);
    this.activeClient = this.createClient(this.activeSource);
  }

  async onModuleInit() {
    await this.activeClient.$connect();
    if (this.activeSource.provider === 'sqlite') {
      await this.ensureSqliteRuntimeSchema();
    }
  }

  async onModuleDestroy() {
    await this.activeClient.$disconnect();
  }

  getSource() {
    return this.activeSource;
  }

  isSqlite() {
    return this.activeSource.provider === 'sqlite';
  }

  async verifyRemote(input: RemoteDatabaseInput) {
    const source = toPostgresDatabaseSource(input);
    const client = this.createPostgresClient(source);
    await client.$connect();
    try {
      await client.$queryRaw`select 1`;
    } finally {
      await client.$disconnect();
    }
    return source;
  }

  async migrateToPostgres(input: RemoteDatabaseInput) {
    const source = await this.verifyRemote(input);
    this.deployPostgresMigrations(source);

    const targetClient = this.createPostgresClient(source);
    await targetClient.$connect();
    try {
      await this.copyData(this.activeClient, targetClient);
    } catch (error) {
      await targetClient.$disconnect();
      throw error;
    }

    const previousClient = this.activeClient;
    this.activeClient = targetClient;
    this.activeSource = source;
    persistDatabaseSource(source);
    await previousClient.$disconnect();
    return source;
  }

  get authSetting(): PrismaClient['authSetting'] {
    return this.activeClient.authSetting as PrismaClient['authSetting'];
  }

  get user(): PrismaClient['user'] {
    return this.activeClient.user as PrismaClient['user'];
  }

  get userMeta(): PrismaClient['userMeta'] {
    return this.activeClient.userMeta as PrismaClient['userMeta'];
  }

  get userIdentity(): PrismaClient['userIdentity'] {
    return this.activeClient.userIdentity as PrismaClient['userIdentity'];
  }

  get authSession(): PrismaClient['authSession'] {
    return this.activeClient.authSession as PrismaClient['authSession'];
  }

  get authPasswordReset(): PrismaClient['authPasswordReset'] {
    return this.activeClient
      .authPasswordReset as PrismaClient['authPasswordReset'];
  }

  get authPasskey(): PrismaClient['authPasskey'] {
    return this.activeClient.authPasskey as PrismaClient['authPasskey'];
  }

  get authChallenge(): PrismaClient['authChallenge'] {
    return this.activeClient.authChallenge as PrismaClient['authChallenge'];
  }

  get authOAuthState(): PrismaClient['authOAuthState'] {
    return this.activeClient.authOAuthState as PrismaClient['authOAuthState'];
  }

  get authOAuthExchangeCode(): PrismaClient['authOAuthExchangeCode'] {
    return this.activeClient
      .authOAuthExchangeCode as PrismaClient['authOAuthExchangeCode'];
  }

  get setting(): PrismaClient['setting'] {
    return this.activeClient.setting as PrismaClient['setting'];
  }

  get workspace(): PrismaClient['workspace'] {
    return this.activeClient.workspace as PrismaClient['workspace'];
  }

  get filePolicySetting(): PrismaClient['filePolicySetting'] {
    return this.activeClient
      .filePolicySetting as PrismaClient['filePolicySetting'];
  }

  get workspaceShareSetting(): PrismaClient['workspaceShareSetting'] {
    return this.activeClient
      .workspaceShareSetting as PrismaClient['workspaceShareSetting'];
  }

  get fileNode(): PrismaClient['fileNode'] {
    return this.activeClient.fileNode as PrismaClient['fileNode'];
  }

  get fileVersion(): PrismaClient['fileVersion'] {
    return this.activeClient.fileVersion as PrismaClient['fileVersion'];
  }

  get previewArtifact(): PrismaClient['previewArtifact'] {
    return this.activeClient.previewArtifact as PrismaClient['previewArtifact'];
  }

  get fileDownloadIntent(): PrismaClient['fileDownloadIntent'] {
    return this.activeClient
      .fileDownloadIntent as PrismaClient['fileDownloadIntent'];
  }

  get uploadSession(): PrismaClient['uploadSession'] {
    return this.activeClient.uploadSession as PrismaClient['uploadSession'];
  }

  get uploadSessionPart(): PrismaClient['uploadSessionPart'] {
    return this.activeClient
      .uploadSessionPart as PrismaClient['uploadSessionPart'];
  }

  get storageSetting(): PrismaClient['storageSetting'] {
    return this.activeClient.storageSetting as PrismaClient['storageSetting'];
  }

  get transferTask(): PrismaClient['transferTask'] {
    return this.activeClient.transferTask as PrismaClient['transferTask'];
  }

  get shareLink(): PrismaClient['shareLink'] {
    return this.activeClient.shareLink as PrismaClient['shareLink'];
  }

  get shareEmailCode(): PrismaClient['shareEmailCode'] {
    return this.activeClient.shareEmailCode as PrismaClient['shareEmailCode'];
  }

  get shareAccessSession(): PrismaClient['shareAccessSession'] {
    return this.activeClient
      .shareAccessSession as PrismaClient['shareAccessSession'];
  }

  get shareDownloadIntent(): PrismaClient['shareDownloadIntent'] {
    return this.activeClient
      .shareDownloadIntent as PrismaClient['shareDownloadIntent'];
  }

  get auditEvent(): PrismaClient['auditEvent'] {
    return this.activeClient.auditEvent as PrismaClient['auditEvent'];
  }

  get blobReconcileTask(): PrismaClient['blobReconcileTask'] {
    return this.activeClient
      .blobReconcileTask as PrismaClient['blobReconcileTask'];
  }

  get $transaction(): PrismaClient['$transaction'] {
    return this.activeClient.$transaction.bind(
      this.activeClient,
    ) as PrismaClient['$transaction'];
  }

  get $queryRaw(): PrismaClient['$queryRaw'] {
    return this.activeClient.$queryRaw.bind(
      this.activeClient,
    ) as PrismaClient['$queryRaw'];
  }

  get $queryRawUnsafe(): PrismaClient['$queryRawUnsafe'] {
    return this.activeClient.$queryRawUnsafe.bind(
      this.activeClient,
    ) as PrismaClient['$queryRawUnsafe'];
  }

  get $executeRaw(): PrismaClient['$executeRaw'] {
    return this.activeClient.$executeRaw.bind(
      this.activeClient,
    ) as PrismaClient['$executeRaw'];
  }

  get $executeRawUnsafe(): PrismaClient['$executeRawUnsafe'] {
    return this.activeClient.$executeRawUnsafe.bind(
      this.activeClient,
    ) as PrismaClient['$executeRawUnsafe'];
  }

  get $connect(): PrismaClient['$connect'] {
    return this.activeClient.$connect.bind(this.activeClient);
  }

  get $disconnect(): PrismaClient['$disconnect'] {
    return this.activeClient.$disconnect.bind(this.activeClient);
  }

  private createClient(source: ActiveDatabaseSource): ActivePrismaClient {
    if (source.provider === 'sqlite') {
      mkdirSync(dirname(source.filePath), { recursive: true });
      const nativeBinding = process.env.BETTER_SQLITE3_NATIVE_BINDING?.trim();
      return new SqlitePrismaClient({
        adapter: new PrismaBetterSqlite3(
          {
            url: source.filePath,
            ...(nativeBinding ? { nativeBinding } : {}),
          },
          { timestampFormat: 'iso8601' },
        ),
      });
    }
    return this.createPostgresClient(source);
  }

  private createPostgresClient(source: PostgresDatabaseSource) {
    return new PrismaClient({
      adapter: new PrismaPg({
        connectionString: buildPostgresUrl(source),
      }),
    });
  }

  private async ensureSqliteRuntimeSchema() {
    await this.ensureSqliteColumn(
      'file_nodes',
      'space_scope',
      "TEXT NOT NULL DEFAULT 'workspace'",
    );
    await this.ensureSqliteColumn(
      'upload_sessions',
      'space_scope',
      "TEXT NOT NULL DEFAULT 'workspace'",
    );
    await this.activeClient.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "file_nodes_workspace_id_space_scope_idx" ON "file_nodes"("workspace_id", "space_scope")',
    );
  }

  private async ensureSqliteColumn(
    tableName: string,
    columnName: string,
    definition: string,
  ) {
    const columns = await this.activeClient.$queryRawUnsafe(
      `PRAGMA table_info("${tableName}")`,
    );
    if (sqliteColumnsInclude(columns, columnName)) return;
    await this.activeClient.$executeRawUnsafe(
      `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`,
    );
  }

  private deployPostgresMigrations(source: PostgresDatabaseSource) {
    const prismaPackage = require.resolve('prisma/package.json', {
      paths: [this.backendRoot],
    });
    const prismaCli = resolve(prismaPackage, '..', 'build', 'index.js');
    const result = spawnSync(
      process.execPath,
      [
        prismaCli,
        'migrate',
        'deploy',
        '--schema',
        '../database/schema.prisma',
        '--config',
        '../prisma.config.ts',
      ],
      {
        cwd: this.backendRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: buildPostgresUrl(source),
        },
      },
    );
    if (result.status !== 0) {
      throw new Error(
        result.stderr?.trim() ||
          result.stdout?.trim() ||
          'Failed to deploy PostgreSQL migrations',
      );
    }
  }

  private async copyData(source: ActivePrismaClient, target: PrismaClient) {
    for (const model of copyModels) {
      const sourceModel = source[model] as unknown as {
        findMany: () => Promise<unknown[]>;
      };
      const targetModel = target[model] as unknown as {
        createMany: (args: {
          data: unknown[];
          skipDuplicates: boolean;
        }) => Promise<unknown>;
      };
      const rows = await sourceModel.findMany();
      if (rows.length === 0) continue;
      await targetModel.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }
  }
}

function sqliteColumnsInclude(columns: unknown, columnName: string) {
  if (!Array.isArray(columns)) return false;
  return columns.some((column) => {
    if (!column || typeof column !== 'object') return false;
    const record = column as Record<string, unknown>;
    return record.name === columnName;
  });
}
