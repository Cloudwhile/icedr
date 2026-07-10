import type { DriveSpaceScope, TransferResponse } from "@/lib/drive-api";

export type TransferStatus = TransferResponse["status"] | "queued";

export type TransferMetrics = {
  loadedBytes: number;
  remainingSeconds: number | null;
  speedBytesPerSecond: number | null;
  totalBytes: number;
};

export type TransferRow = Omit<TransferResponse, "status"> & {
  errorMessage?: string | null;
  status: TransferStatus;
} & Partial<TransferMetrics>;

export type UploadTelemetry = Omit<TransferResponse, "status"> & {
  errorMessage?: string | null;
  spaceScope?: DriveSpaceScope;
  status: TransferStatus;
} & TransferMetrics;
