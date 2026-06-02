import type { TransferResponse } from "@/lib/drive-api";

export type TransferStatus = TransferResponse["status"] | "queued";

export type TransferMetrics = {
  loadedBytes: number;
  remainingSeconds: number | null;
  speedBytesPerSecond: number | null;
  totalBytes: number;
};

export type TransferRow = Omit<TransferResponse, "status"> & {
  status: TransferStatus;
} & Partial<TransferMetrics>;

export type UploadTelemetry = Omit<TransferResponse, "status"> & {
  status: TransferStatus;
} & TransferMetrics;
