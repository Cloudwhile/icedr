import type {
  DriveSpaceScope,
  TransferResponse,
  TransferTaskFailureCode,
  TransferTaskLifecycle,
  TransferTaskStatus,
} from "@/lib/drive-api";

export type TransferStatus = TransferTaskStatus;
export type TransferStatusSource = TransferStatus | "queued" | "idle";

export type TransferMetrics = {
  loadedBytes: number;
  remainingSeconds: number | null;
  speedBytesPerSecond: number | null;
  totalBytes: number;
};

type TransferRowBase = Omit<
  TransferResponse,
  "status" | "failureCode" | "expiresAt" | "lifecycle"
> & {
  errorMessage?: string | null;
  expiresAt?: string | null;
  failureCode?: TransferTaskFailureCode | null;
  lifecycle?: TransferTaskLifecycle;
  status: TransferStatusSource;
} & Partial<TransferMetrics>;

export type TransferRow = TransferRowBase;

export type UploadTelemetry = TransferRowBase & {
  spaceScope?: DriveSpaceScope;
} & TransferMetrics;
