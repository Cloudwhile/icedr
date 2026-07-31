import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { WorkspaceNotificationTone } from "@/components/ui/workspace-notification-store";
import type { UploadDriveFileTask } from "@/features/file/actions";
import {
  clearUploadRecoveryBatch,
  createUploadRecoveryDescriptor,
  readUploadRecoveryDescriptors,
  removeUploadRecoveryDescriptor,
  saveUploadRecoveryDescriptor,
  type UploadRecoveryDescriptor,
} from "@/features/file/upload-recovery";
import type { useTranslations } from "@/i18n/react";
import {
  DriveApiError,
  fetchUploadSessionRecovery,
  updateTransfer,
  type TransferTaskStatus,
} from "@/lib/drive-api";
import {
  createLocalUploadLifecycle,
  createRecoveryTelemetry,
  matchesRecoverySession,
} from "./drive-transfer-helpers";
import type { UploadTelemetry } from "./drive-types";

type UploadRecoveryPersistState = {
  progress: number;
  status: TransferTaskStatus;
  updatedAt: number;
};

type UploadRecoveryHydrationResult =
  | {
      descriptor: UploadRecoveryDescriptor;
      telemetry: UploadTelemetry;
    }
  | { invalid: true }
  | null;

type UseUploadRecoveryHydrationOptions = {
  setControllableTransferIds: Dispatch<SetStateAction<string[]>>;
  setUploadTelemetry: Dispatch<SetStateAction<Record<string, UploadTelemetry>>>;
  showFeedback: (
    message: string,
    tone?: WorkspaceNotificationTone,
  ) => void;
  t: ReturnType<typeof useTranslations>;
  uploadOwnerUserId?: string;
  uploadRecoveryDescriptorsRef: MutableRefObject<
    Map<string, UploadRecoveryDescriptor>
  >;
  uploadRecoveryPersistRef: MutableRefObject<
    Map<string, UploadRecoveryPersistState>
  >;
  uploadTasksRef: MutableRefObject<Map<string, UploadDriveFileTask>>;
  workspaceId: string | null;
};

export function useUploadRecoveryHydration({
  setControllableTransferIds,
  setUploadTelemetry,
  showFeedback,
  t,
  uploadOwnerUserId,
  uploadRecoveryDescriptorsRef,
  uploadRecoveryPersistRef,
  uploadTasksRef,
  workspaceId,
}: UseUploadRecoveryHydrationOptions) {
  const generationRef = useRef(0);
  const showFeedbackRef = useRef(showFeedback);
  const tRef = useRef(t);

  useEffect(() => {
    showFeedbackRef.current = showFeedback;
    tRef.current = t;
  }, [showFeedback, t]);

  useEffect(() => {
    const generation = ++generationRef.current;
    let disposed = false;
    const isCurrent = () =>
      !disposed && generationRef.current === generation;
    const isLive = (descriptor: UploadRecoveryDescriptor) =>
      uploadTasksRef.current.has(descriptor.transferId);
    const removeStoredDescriptor = (descriptor: UploadRecoveryDescriptor) => {
      if (!isCurrent() || isLive(descriptor)) return false;
      removeUploadRecoveryDescriptor(descriptor.sessionId);
      return true;
    };
    const saveStoredDescriptor = (descriptor: UploadRecoveryDescriptor) => {
      if (!isCurrent() || isLive(descriptor)) return false;
      saveUploadRecoveryDescriptor(descriptor);
      return true;
    };

    const previousRecoveryIds = new Set(
      uploadRecoveryDescriptorsRef.current.keys(),
    );
    uploadRecoveryDescriptorsRef.current.clear();
    uploadRecoveryPersistRef.current.clear();
    if (previousRecoveryIds.size > 0) {
      setUploadTelemetry((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([id, row]) =>
              !previousRecoveryIds.has(id) || !row.recoveryRequired,
          ),
        ),
      );
    }
    if (!workspaceId || !uploadOwnerUserId) {
      setControllableTransferIds(Array.from(uploadTasksRef.current.keys()));
      return () => {
        disposed = true;
      };
    }

    const allStored = readUploadRecoveryDescriptors().filter(
      (descriptor) =>
        descriptor.workspaceId === workspaceId &&
        descriptor.ownerUserId === uploadOwnerUserId,
    );
    const liveStored = allStored.filter(isLive);
    const stored = allStored.filter((descriptor) => !isLive(descriptor));
    const liveBatchIds = new Set(
      liveStored.map((descriptor) => descriptor.batchId),
    );
    liveStored.forEach((descriptor) => {
      uploadRecoveryDescriptorsRef.current.set(
        descriptor.transferId,
        descriptor,
      );
    });
    if (stored.length === 0) {
      setControllableTransferIds(Array.from(uploadTasksRef.current.keys()));
      return () => {
        disposed = true;
      };
    }

    const hydrateDescriptor = async (
      descriptor: UploadRecoveryDescriptor,
    ): Promise<UploadRecoveryHydrationResult> => {
      try {
        let recovery = await fetchUploadSessionRecovery(descriptor.sessionId);
        if (!isCurrent() || isLive(descriptor)) return null;
        if (!matchesRecoverySession(descriptor, recovery)) {
          return removeStoredDescriptor(descriptor)
            ? { invalid: true }
            : null;
        }

        if (recovery.lifecycle.status === "running") {
          try {
            if (!isCurrent() || isLive(descriptor)) return null;
            const paused = await updateTransfer(recovery.transferId, {
              expectedStatus: "running",
              progress: recovery.progress,
              status: "paused",
            });
            if (!isCurrent() || isLive(descriptor)) return null;
            recovery = {
              ...recovery,
              failureCode: paused.failureCode,
              lifecycle: paused.lifecycle,
              status: paused.status,
            };
          } catch {
            if (!isCurrent() || isLive(descriptor)) return null;
            recovery = await fetchUploadSessionRecovery(descriptor.sessionId);
            if (!isCurrent() || isLive(descriptor)) return null;
          }
        }

        const serverStatus = recovery.lifecycle.status;
        if (serverStatus === "expired" || serverStatus === "canceled") {
          return removeStoredDescriptor(descriptor)
            ? { invalid: true }
            : null;
        }
        const status = serverStatus === "running" ? "paused" : serverStatus;
        const lifecycle =
          status === serverStatus
            ? recovery.lifecycle
            : createLocalUploadLifecycle(
                status,
                recovery.lifecycle.updatedAt,
                recovery.lifecycle.errorCode,
                false,
                recovery.lifecycle,
              );
        const expiresAt = recovery.expiresAt ?? lifecycle.expiresAt;
        if (!expiresAt) {
          return removeStoredDescriptor(descriptor)
            ? { invalid: true }
            : null;
        }
        const reconciled = createUploadRecoveryDescriptor({
          ...descriptor,
          expiresAt,
          failureCode: lifecycle.errorCode,
          progress: recovery.progress,
          status,
          updatedAt: lifecycle.updatedAt,
          uploadedBytes: recovery.uploadedBytes,
        });
        if (!saveStoredDescriptor(reconciled)) return null;
        return {
          descriptor: reconciled,
          telemetry: createRecoveryTelemetry(
            reconciled,
            lifecycle,
            recovery.fileName,
            tRef.current("upload.recoveryHint"),
          ),
        };
      } catch (error) {
        if (!isCurrent() || isLive(descriptor)) return null;
        if (
          error instanceof DriveApiError &&
          (error.status === 404 || error.status === 410)
        ) {
          return removeStoredDescriptor(descriptor)
            ? { invalid: true }
            : null;
        }
        const expiresAt = new Date(descriptor.expiresAt).getTime();
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          return removeStoredDescriptor(descriptor)
            ? { invalid: true }
            : null;
        }
        const status =
          descriptor.status === "pending" || descriptor.status === "running"
            ? "paused"
            : descriptor.status;
        const updatedAt = new Date().toISOString();
        const lifecycle = createLocalUploadLifecycle(
          status,
          updatedAt,
          descriptor.failureCode,
          status === "failed",
        );
        const reconciled = createUploadRecoveryDescriptor({
          ...descriptor,
          status,
          updatedAt,
        });
        if (!saveStoredDescriptor(reconciled)) return null;
        return {
          descriptor: reconciled,
          telemetry: createRecoveryTelemetry(
            reconciled,
            lifecycle,
            reconciled.fileName,
            tRef.current("upload.recoveryHint"),
          ),
        };
      }
    };

    void Promise.all(stored.map(hydrateDescriptor)).then((results) => {
      if (!isCurrent()) return;
      const reconciled = results.flatMap((result) =>
        result && "descriptor" in result ? [result] : [],
      );
      const recoverableBatchIds = new Set([
        ...liveBatchIds,
        ...reconciled
          .filter(
            ({ descriptor }) =>
              descriptor.status === "pending" ||
              descriptor.status === "running" ||
              descriptor.status === "paused" ||
              descriptor.status === "failed",
          )
          .map(({ descriptor }) => descriptor.batchId),
      ]);
      const visible = reconciled.filter(
        ({ descriptor }) =>
          descriptor.status !== "completed" ||
          recoverableBatchIds.has(descriptor.batchId),
      );
      const hiddenCompletedBatchIds = new Set(
        reconciled
          .filter(
            ({ descriptor }) =>
              descriptor.status === "completed" &&
              !recoverableBatchIds.has(descriptor.batchId),
          )
          .map(({ descriptor }) => descriptor.batchId),
      );
      hiddenCompletedBatchIds.forEach((batchId) =>
        clearUploadRecoveryBatch(batchId),
      );
      visible.forEach(({ descriptor }) => {
        uploadRecoveryDescriptorsRef.current.set(
          descriptor.transferId,
          descriptor,
        );
      });
      setUploadTelemetry((current) => {
        const next = { ...current };
        visible.forEach(({ telemetry }) => {
          next[telemetry.id] = telemetry;
        });
        return next;
      });
      setControllableTransferIds(
        Array.from(
          new Set([
            ...uploadTasksRef.current.keys(),
            ...visible
              .filter(({ descriptor }) => descriptor.status !== "completed")
              .map(({ descriptor }) => descriptor.transferId),
          ]),
        ),
      );
      if (results.some((result) => result && "invalid" in result)) {
        showFeedbackRef.current(
          tRef.current("upload.recoveryUnavailable"),
          "neutral",
        );
      }
    });

    return () => {
      disposed = true;
    };
  }, [
    setControllableTransferIds,
    setUploadTelemetry,
    uploadOwnerUserId,
    uploadRecoveryDescriptorsRef,
    uploadRecoveryPersistRef,
    uploadTasksRef,
    workspaceId,
  ]);
}
