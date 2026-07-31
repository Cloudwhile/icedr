import { useState } from "react";
import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceNotificationTone } from "@/components/ui/workspace-notification-store";
import type { UploadDriveFileTask } from "@/features/file/actions";
import {
  createUploadRecoveryDescriptor,
  readUploadRecoveryDescriptors,
  saveUploadRecoveryDescriptor,
  type UploadRecoveryDescriptor,
} from "@/features/file/upload-recovery";
import type { UploadTelemetry } from "./drive-types";
import { useUploadRecoveryHydration } from "./use-upload-recovery-hydration";

const fetchUploadSessionRecoveryMock = vi.hoisted(() => vi.fn());
const updateTransferMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/drive-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/drive-api")>();
  return {
    ...actual,
    fetchUploadSessionRecovery: fetchUploadSessionRecoveryMock,
    updateTransfer: updateTransferMock,
  };
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  fetchUploadSessionRecoveryMock.mockReset();
  updateTransferMock.mockReset();
});

describe("useUploadRecoveryHydration", () => {
  it("does not rehydrate or pause sessions when translation callbacks change", async () => {
    const descriptor = createDescriptor();
    saveUploadRecoveryDescriptor(descriptor);
    fetchUploadSessionRecoveryMock.mockResolvedValue(
      createRecoveryResponse(descriptor),
    );
    const refs = createHydrationRefs();
    const { rerender } = renderHydration(refs, {
      showFeedback: vi.fn(),
      t: (key) => `first:${key}`,
      uploadOwnerUserId: descriptor.ownerUserId,
      workspaceId: descriptor.workspaceId,
    });

    await waitFor(() =>
      expect(fetchUploadSessionRecoveryMock).toHaveBeenCalledTimes(1),
    );

    rerender({
      showFeedback: vi.fn(),
      t: (key) => `second:${key}`,
      uploadOwnerUserId: descriptor.ownerUserId,
      workspaceId: descriptor.workspaceId,
    });
    await act(async () => Promise.resolve());

    expect(fetchUploadSessionRecoveryMock).toHaveBeenCalledTimes(1);
    expect(updateTransferMock).not.toHaveBeenCalled();
  });

  it("skips a stored session that still has a live in-memory task", async () => {
    const descriptor = createDescriptor();
    saveUploadRecoveryDescriptor(descriptor);
    const refs = createHydrationRefs();
    refs.uploadTasksRef.current.set(
      descriptor.transferId,
      {} as UploadDriveFileTask,
    );
    renderHydration(refs, {
      showFeedback: vi.fn(),
      t: (key) => key,
      uploadOwnerUserId: descriptor.ownerUserId,
      workspaceId: descriptor.workspaceId,
    });

    await act(async () => Promise.resolve());

    expect(fetchUploadSessionRecoveryMock).not.toHaveBeenCalled();
    expect(updateTransferMock).not.toHaveBeenCalled();
  });

  it("retains completed siblings while the same batch still has a live task", async () => {
    const liveDescriptor = createDescriptor();
    const completedDescriptor = createUploadRecoveryDescriptor({
      ...liveDescriptor,
      progress: 100,
      sessionId: "session-completed",
      status: "completed",
      transferId: "transfer-completed",
      uploadedBytes: liveDescriptor.fileSize,
    });
    saveUploadRecoveryDescriptor(liveDescriptor);
    saveUploadRecoveryDescriptor(completedDescriptor);
    fetchUploadSessionRecoveryMock.mockResolvedValue(
      createRecoveryResponse(completedDescriptor, {
        status: "completed",
      }),
    );
    const refs = createHydrationRefs();
    refs.uploadTasksRef.current.set(
      liveDescriptor.transferId,
      {} as UploadDriveFileTask,
    );
    renderHydration(refs, {
      showFeedback: vi.fn(),
      t: (key) => key,
      uploadOwnerUserId: liveDescriptor.ownerUserId,
      workspaceId: liveDescriptor.workspaceId,
    });

    await waitFor(() =>
      expect(fetchUploadSessionRecoveryMock).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(readUploadRecoveryDescriptors()).toHaveLength(2),
    );

    expect(
      readUploadRecoveryDescriptors().map(({ sessionId }) => sessionId).sort(),
    ).toEqual(["session-1", "session-completed"]);
    expect(updateTransferMock).not.toHaveBeenCalled();
  });

  it("does not mutate storage after a newer owner or workspace generation wins", async () => {
    const descriptor = createDescriptor();
    saveUploadRecoveryDescriptor(descriptor);
    const deferred = createDeferred<ReturnType<typeof createRecoveryResponse>>();
    fetchUploadSessionRecoveryMock.mockReturnValue(deferred.promise);
    const refs = createHydrationRefs();
    const { rerender } = renderHydration(refs, {
      showFeedback: vi.fn(),
      t: (key) => key,
      uploadOwnerUserId: descriptor.ownerUserId,
      workspaceId: descriptor.workspaceId,
    });
    await waitFor(() =>
      expect(fetchUploadSessionRecoveryMock).toHaveBeenCalledTimes(1),
    );

    rerender({
      showFeedback: vi.fn(),
      t: (key) => key,
      uploadOwnerUserId: "owner-new",
      workspaceId: "workspace-new",
    });
    deferred.resolve(
      createRecoveryResponse(descriptor, {
        progress: 88,
        uploadedBytes: 88,
      }),
    );
    await act(async () => deferred.promise);

    expect(readUploadRecoveryDescriptors()).toEqual([descriptor]);
    expect(updateTransferMock).not.toHaveBeenCalled();
  });
});

type HydrationProps = {
  showFeedback: (message: string, tone?: WorkspaceNotificationTone) => void;
  t: (key: string) => string;
  uploadOwnerUserId?: string;
  workspaceId: string | null;
};

function renderHydration(
  refs: ReturnType<typeof createHydrationRefs>,
  initialProps: HydrationProps,
) {
  return renderHook(
    (props: HydrationProps) => {
      const [, setControllableTransferIds] = useState<string[]>([]);
      const [, setUploadTelemetry] = useState<
        Record<string, UploadTelemetry>
      >({});
      useUploadRecoveryHydration({
        ...props,
        ...refs,
        setControllableTransferIds,
        setUploadTelemetry,
      });
    },
    { initialProps },
  );
}

function createHydrationRefs() {
  return {
    uploadRecoveryDescriptorsRef: {
      current: new Map<string, UploadRecoveryDescriptor>(),
    },
    uploadRecoveryPersistRef: {
      current: new Map<
        string,
        { progress: number; status: UploadRecoveryDescriptor["status"]; updatedAt: number }
      >(),
    },
    uploadTasksRef: {
      current: new Map<string, UploadDriveFileTask>(),
    },
  };
}

function createDescriptor() {
  const updatedAt = new Date().toISOString();
  return createUploadRecoveryDescriptor({
    batchId: "batch-1",
    conflictStrategy: "version",
    contentFingerprint: `sha256:${"0".repeat(64)}`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    failureCode: null,
    fileLastModified: 1,
    fileName: "resume.txt",
    fileSize: 100,
    mimeType: "text/plain",
    ownerUserId: "owner-1",
    parentNodeId: null,
    progress: 25,
    resumeIdentity: `drive-upload-v2:${"1".repeat(64)}`,
    sessionId: "session-1",
    spaceScope: "workspace",
    status: "paused",
    transferId: "transfer-1",
    updatedAt,
    uploadedBytes: 25,
    workspaceId: "workspace-1",
  });
}

function createRecoveryResponse(
  descriptor: UploadRecoveryDescriptor,
  overrides: {
    progress?: number;
    status?: "completed" | "paused";
    uploadedBytes?: number;
  } = {},
) {
  const progress = overrides.progress ?? descriptor.progress;
  const status = overrides.status ?? "paused";
  const uploadedBytes = overrides.uploadedBytes ?? descriptor.uploadedBytes;
  return {
    chunkSizeBytes: 25,
    conflictStrategy: descriptor.conflictStrategy,
    expiresAt: descriptor.expiresAt,
    failureCode: descriptor.failureCode,
    fileName: descriptor.fileName,
    lifecycle: {
      createdAt: descriptor.updatedAt,
      errorCode: null,
      errorMessage: null,
      expiresAt: descriptor.expiresAt,
      retryable: false,
      status,
      updatedAt: descriptor.updatedAt,
    },
    mimeType: descriptor.mimeType,
    parentNodeId: descriptor.parentNodeId,
    progress,
    recoveryMode: "upload" as const,
    requestedFileName: descriptor.fileName,
    sessionId: descriptor.sessionId,
    sizeBytes: descriptor.fileSize,
    spaceScope: descriptor.spaceScope,
    status,
    transferId: descriptor.transferId,
    uploadedBytes,
    uploadedPartIndexes: [0],
    workspaceId: descriptor.workspaceId,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
