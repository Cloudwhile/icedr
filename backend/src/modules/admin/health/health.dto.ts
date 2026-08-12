export type AdminHealthStatus = 'ok' | 'warning' | 'error' | 'unknown';
export type AdminHealthCheckId =
  | 'application'
  | 'database'
  | 'storage'
  | 'mail'
  | 'queue'
  | 'reconcile';

export type AdminHealthCheck = {
  id: AdminHealthCheckId;
  status: AdminHealthStatus;
  checkedAt: string;
  durationMs: number;
  reason: string | null;
  settingsPath: string | null;
};

export type AdminHealthResponse = {
  status: AdminHealthStatus;
  checkedAt: string;
  checks: AdminHealthCheck[];
};
