"use client";

import { DriveApp } from "./drive-app";

export function FilePreviewRoute({
  itemId,
}: {
  itemId: string;
}) {
  return <DriveApp initialPreviewItemId={itemId} />;
}
