import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaClient as SqlitePrismaClient } from '../generated/prisma-sqlite/client';
import { createFileNodeStorageKeys } from '../common/security/file-name-policy';
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

type FileNodeNameKeyRow = {
  archivedAt: Date | null;
  directoryKey: string;
  id: string;
  name: string;
  nameKey: string;
  ownerScopeKey: string;
  ownerUserId: string | null;
  parentNodeId: string | null;
  spaceScope: string;
  workspaceId: string;
};

type FileNodeNameKeyModel = {
  findMany: (input: {
    select: Record<keyof FileNodeNameKeyRow, true>;
  }) => Promise<FileNodeNameKeyRow[]>;
  update: (input: {
    data: Pick<
      FileNodeNameKeyRow,
      'directoryKey' | 'nameKey' | 'ownerScopeKey'
    >;
    where: { id: string };
  }) => Promise<unknown>;
};

const postgresMigrationDeployTimeoutMilliseconds = 10 * 60 * 1000;

const copyModels = [
  'authSetting',
  'user',
  'userMeta',
  'userIdentity',
  'authSession',
  'authPasswordReset',
  'authPasskey',
  'authChallenge',
  'authRateLimit',
  'authStepUpToken',
  'authRecoveryCode',
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
  'shareContentMember',
  'shareEmailCode',
  'shareAccessSession',
  'shareDownloadIntent',
  'auditEvent',
  'blobReconcileTask',
  'setupOperation',
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
    await this.ensureFileNodeNameKeys();
    if (this.activeSource.provider === 'sqlite') {
      await this.ensureSqliteFileNodeNameIndex();
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
    await this.deployPostgresMigrations(source);

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

  get authRateLimit(): PrismaClient['authRateLimit'] {
    return this.activeClient.authRateLimit as PrismaClient['authRateLimit'];
  }

  get authStepUpToken(): PrismaClient['authStepUpToken'] {
    return this.activeClient.authStepUpToken as PrismaClient['authStepUpToken'];
  }

  get authRecoveryCode(): PrismaClient['authRecoveryCode'] {
    return this.activeClient
      .authRecoveryCode as PrismaClient['authRecoveryCode'];
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

  get setupOperation(): PrismaClient['setupOperation'] {
    return this.activeClient.setupOperation as PrismaClient['setupOperation'];
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

  get shareContentMember(): PrismaClient['shareContentMember'] {
    return this.activeClient
      .shareContentMember as PrismaClient['shareContentMember'];
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
      'auth_settings',
      'minimum_authentication_methods',
      'INTEGER NOT NULL DEFAULT 1',
    );
    await this.ensureSqliteColumn('auth_passkeys', 'aaguid', 'TEXT');
    await this.ensureSqliteColumn(
      'auth_passkeys',
      'created_user_agent',
      'TEXT',
    );
    await this.ensureSqliteColumn('auth_passkeys', 'created_ip_hash', 'TEXT');
    await this.ensureSqliteColumn(
      'auth_passkeys',
      'last_used_user_agent',
      'TEXT',
    );
    await this.ensureSqliteColumn('auth_passkeys', 'last_used_ip_hash', 'TEXT');
    await this.ensureSqliteColumn(
      'auth_challenges',
      'attempt_count',
      'INTEGER NOT NULL DEFAULT 0',
    );
    await this.ensureSqliteColumn('auth_challenges', 'claimed_at', 'TEXT');
    await this.ensureSqliteColumn(
      'auth_challenges',
      'claim_token_hash',
      'TEXT',
    );
    await this.ensureSqliteColumn('auth_oauth_states', 'user_id', 'TEXT');
    await this.ensureSqliteColumn(
      'auth_oauth_states',
      'session_token_hash',
      'TEXT',
    );
    await this.ensureSqliteColumn('auth_oauth_states', 'purpose', 'TEXT');
    await this.ensureSqliteColumn(
      'auth_oauth_exchange_codes',
      'flow',
      "TEXT NOT NULL DEFAULT 'login'",
    );
    await this.ensureSqliteColumn(
      'auth_oauth_exchange_codes',
      'session_token_hash',
      'TEXT',
    );
    await this.ensureSqliteColumn(
      'auth_oauth_exchange_codes',
      'purpose',
      'TEXT',
    );
    await this.ensureSqlitePasskeySecurityTables();
    await this.ensureSqliteSetupOperationTable();
    await this.ensureSqliteColumn(
      'file_nodes',
      'space_scope',
      "TEXT NOT NULL DEFAULT 'workspace'",
    );
    await this.ensureSqliteColumn(
      'file_nodes',
      'directory_key',
      "TEXT NOT NULL DEFAULT ''",
    );
    await this.ensureSqliteColumn(
      'file_nodes',
      'owner_scope_key',
      "TEXT NOT NULL DEFAULT ''",
    );
    await this.ensureSqliteColumn(
      'file_nodes',
      'name_key',
      "TEXT NOT NULL DEFAULT ''",
    );
    await this.ensureSqliteColumn(
      'upload_sessions',
      'space_scope',
      "TEXT NOT NULL DEFAULT 'workspace'",
    );
    await this.activeClient.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "file_nodes_workspace_id_space_scope_idx" ON "file_nodes"("workspace_id", "space_scope")',
    );
    await this.activeClient.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "auth_challenges_flow_expires_at_used_at_idx" ON "auth_challenges"("flow", "expires_at", "used_at")',
    );
  }

  private async ensureFileNodeNameKeys() {
    const model = this.activeClient.fileNode as unknown as FileNodeNameKeyModel;
    const rows = await model.findMany({
      select: {
        archivedAt: true,
        directoryKey: true,
        id: true,
        name: true,
        nameKey: true,
        ownerScopeKey: true,
        ownerUserId: true,
        parentNodeId: true,
        spaceScope: true,
        workspaceId: true,
      },
    });
    const canonicalRows = rows.map((row) => {
      try {
        return {
          row,
          storageKeys: createFileNodeStorageKeys({
            archived: Boolean(row.archivedAt),
            id: row.id,
            name: row.name,
            ownerUserId: row.ownerUserId,
            parentNodeId: row.parentNodeId,
            spaceScope: row.spaceScope,
          }),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'invalid file name keys';
        throw new Error(`File node ${row.id} cannot be migrated: ${message}`);
      }
    });
    const activeKeys = new Map<string, string>();

    for (const { row, storageKeys } of canonicalRows) {
      if (row.archivedAt) continue;
      const uniqueKey = JSON.stringify([
        row.workspaceId,
        row.spaceScope,
        storageKeys.ownerScopeKey,
        storageKeys.directoryKey,
        storageKeys.nameKey,
      ]);
      const existingId = activeKeys.get(uniqueKey);
      if (existingId) {
        throw new Error(
          `Duplicate active file names must be resolved before startup: ${existingId}, ${row.id}`,
        );
      }
      activeKeys.set(uniqueKey, row.id);
    }

    const operations = canonicalRows
      .filter(
        ({ row, storageKeys }) =>
          row.directoryKey !== storageKeys.directoryKey ||
          row.ownerScopeKey !== storageKeys.ownerScopeKey ||
          row.nameKey !== storageKeys.nameKey,
      )
      .map(({ row, storageKeys }) =>
        model.update({
          where: { id: row.id },
          data: storageKeys,
        }),
      );
    if (operations.length > 0) {
      const transaction = this.activeClient.$transaction.bind(
        this.activeClient,
      ) as unknown as (operations: Promise<unknown>[]) => Promise<unknown>;
      await transaction(operations);
    }
  }

  private async ensureSqliteFileNodeNameIndex() {
    await this.activeClient.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "file_nodes_scope_directory_name_key" ON "file_nodes"("workspace_id", "space_scope", "owner_scope_key", "directory_key", "name_key")',
    );
  }

  private async ensureSqlitePasskeySecurityTables() {
    const statements = [
      'CREATE TABLE IF NOT EXISTS "auth_rate_limits" ("id" TEXT NOT NULL PRIMARY KEY, "action" TEXT NOT NULL, "scope_hash" TEXT NOT NULL, "window_started_at" TEXT NOT NULL, "count" INTEGER NOT NULL DEFAULT 1, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE UNIQUE INDEX IF NOT EXISTS "auth_rate_limits_action_scope_hash_key" ON "auth_rate_limits"("action", "scope_hash")',
      'CREATE INDEX IF NOT EXISTS "auth_rate_limits_updated_at_idx" ON "auth_rate_limits"("updated_at")',
      'CREATE TABLE IF NOT EXISTS "auth_step_up_tokens" ("token_hash" TEXT NOT NULL PRIMARY KEY, "user_id" TEXT NOT NULL, "session_token_hash" TEXT NOT NULL, "method" TEXT NOT NULL, "purpose" TEXT NOT NULL, "expires_at" TEXT NOT NULL, "used_at" TEXT, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "auth_step_up_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE)',
      'CREATE INDEX IF NOT EXISTS "auth_step_up_tokens_user_id_purpose_expires_at_idx" ON "auth_step_up_tokens"("user_id", "purpose", "expires_at")',
      'CREATE TABLE IF NOT EXISTS "auth_recovery_codes" ("id" TEXT NOT NULL PRIMARY KEY, "user_id" TEXT NOT NULL, "batch_id" TEXT NOT NULL, "code_hash" TEXT NOT NULL, "used_at" TEXT, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "auth_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE)',
      'CREATE UNIQUE INDEX IF NOT EXISTS "auth_recovery_codes_code_hash_key" ON "auth_recovery_codes"("code_hash")',
      'CREATE INDEX IF NOT EXISTS "auth_recovery_codes_user_id_used_at_idx" ON "auth_recovery_codes"("user_id", "used_at")',
    ];
    for (const statement of statements) {
      await this.activeClient.$executeRawUnsafe(statement);
    }
  }

  private async ensureSqliteSetupOperationTable() {
    const statements = [
      'CREATE TABLE IF NOT EXISTS "setup_operations" ("operation_key" TEXT NOT NULL PRIMARY KEY, "status" TEXT NOT NULL, "payload_fingerprint" TEXT NOT NULL, "claim_token_hash" TEXT, "claimed_at" TEXT, "claim_expires_at" TEXT, "irreversible_started_at" TEXT, "completed_at" TEXT, "failed_at" TEXT, "failure_code" TEXT, "failure_message" TEXT, "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE INDEX IF NOT EXISTS "setup_operations_status_claim_expires_at_idx" ON "setup_operations"("status", "claim_expires_at")',
    ];
    for (const statement of statements) {
      await this.activeClient.$executeRawUnsafe(statement);
    }
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

  private async deployPostgresMigrations(source: PostgresDatabaseSource) {
    const prismaPackage = require.resolve('prisma/package.json', {
      paths: [this.backendRoot],
    });
    const prismaCli = resolve(prismaPackage, '..', 'build', 'index.js');
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(
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
          env: {
            ...process.env,
            DATABASE_URL: buildPostgresUrl(source),
          },
          windowsHide: true,
        },
      );
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        child.removeListener('error', onError);
        child.removeListener('close', onClose);
        complete();
      };
      const onError = (error: Error) => {
        finish(() => rejectPromise(error));
      };
      const onClose = (code: number | null) => {
        finish(() => {
          if (code === 0) {
            resolvePromise();
            return;
          }
          rejectPromise(
            new Error(
              stderr.trim() ||
                stdout.trim() ||
                'Failed to deploy PostgreSQL migrations',
            ),
          );
        });
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.once('error', onError);
      child.once('close', onClose);
      timer = setTimeout(() => {
        finish(() => {
          try {
            child.kill('SIGKILL');
          } catch (error) {
            rejectPromise(
              new Error('PostgreSQL migration deploy timed out', {
                cause: error,
              }),
            );
            return;
          }
          rejectPromise(new Error('PostgreSQL migration deploy timed out'));
        });
      }, postgresMigrationDeployTimeoutMilliseconds);
      timer.unref();
    });
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
        }) => Promise<{ count: number }>;
      };
      const rows = await sourceModel.findMany();
      if (rows.length === 0) continue;
      const result = await targetModel.createMany({
        data: rows,
        skipDuplicates: false,
      });
      if (result.count !== rows.length) {
        throw new Error(
          `Database migration copied ${result.count} of ${rows.length} ${model} rows`,
        );
      }
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
