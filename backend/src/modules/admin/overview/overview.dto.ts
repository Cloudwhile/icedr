import type {
  AuditEventRecord,
  AuditResourceType,
  AuditScope,
} from '../../logs/audit-events';

export type OverviewQuery = {
  scope?: 'all' | 'system' | 'workspace';
  workspaceId?: string;
  from?: string;
  to?: string;
};

export type OverviewResponse = {
  scope: AuditScope;
  window: { from: string; to: string };
  generatedAt: string;
  workspaceCount: number;
  storage: {
    activeBytes: number;
    trashBytes: number;
    versionBytes: number;
    usedBytes: number;
    fileCount: number;
    trashFileCount: number;
    folderCount: number;
    versionCount: number;
  };
  audit: {
    total: number;
    failed: number;
    dailyTrend: Array<{ date: string; total: number; failed: number }>;
    resourceDistribution: Array<{
      resourceType: AuditResourceType;
      total: number;
    }>;
    recentRiskEvents: AuditEventRecord[];
  };
};
