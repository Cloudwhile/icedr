import type { TransferResponse } from "@/lib/drive-api";

export type TransferMetrics = {
  loadedBytes: number;
  remainingSeconds: number | null;
  speedBytesPerSecond: number | null;
  totalBytes: number;
};

export type TransferRow = TransferResponse & Partial<TransferMetrics>;

export type UploadTelemetry = TransferResponse & TransferMetrics;
