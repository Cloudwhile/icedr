import {
  getTaskLifecycleFailureMessageKey,
  resolveTaskLifecycleStatus,
  type TaskLifecycleSource,
} from "./task-lifecycle";

type PreviewCapabilityStatus = {
  downloadOnly: boolean;
  supported: boolean;
};

export function getPreviewStatusMessageKey(
  previewIntent: TaskLifecycleSource | null,
  previewCapability?: PreviewCapabilityStatus | null,
) {
  if (previewIntent) {
    const lifecycleStatus = resolveTaskLifecycleStatus(previewIntent);
    if (lifecycleStatus === "failed" || lifecycleStatus === "expired") {
      return getTaskLifecycleFailureMessageKey(previewIntent);
    }
  }

  if (previewCapability?.downloadOnly) return "preview.downloadOnlyHint";
  if (previewCapability && !previewCapability.supported) return "preview.unsupportedHint";
  if (previewIntent) {
    return `preview.lifecycleStatus.${resolveTaskLifecycleStatus(previewIntent)}`;
  }
  return "preview.notConfigured";
}

export function getPreviewTitleMessageKey(
  previewIntent: TaskLifecycleSource | null,
  previewCapability?: PreviewCapabilityStatus | null,
) {
  if (previewIntent) {
    const lifecycleStatus = resolveTaskLifecycleStatus(previewIntent);
    if (lifecycleStatus === "failed" || lifecycleStatus === "expired") {
      return getTaskLifecycleFailureMessageKey(previewIntent);
    }
  }

  return previewCapability?.downloadOnly || (previewCapability && !previewCapability.supported)
    ? "preview.unsupportedHint"
    : "preview.officeHint";
}
