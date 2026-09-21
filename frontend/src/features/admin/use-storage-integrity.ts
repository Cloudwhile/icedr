import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdminScope } from "./admin-scope";
import {
  acknowledgeStorageIntegrityResult,
  createStorageIntegrityTask,
  fetchStorageIntegrityResults,
  fetchStorageIntegritySummary,
  fetchStorageIntegrityTask,
  fetchStorageIntegrityTasks,
  retryStorageIntegrityTask,
  type CreateStorageIntegrityTaskInput,
  type StorageIntegrityResultFilter,
  type StorageIntegrityResult,
  type StorageIntegrityResultsResponse,
  type StorageIntegrityTask,
  type StorageIntegrityTasksResponse,
  type StorageIntegritySummary,
} from "@/lib/drive-api";

type IntegrityAdminScope = Extract<
  AdminScope,
  { kind: "all" | "workspace" }
>;

type UseStorageIntegrityOptions = {
  onTaskIdChange: (taskId: string | null) => void;
  pollIntervalMs?: number;
  requestedTaskId: string | null;
  scope: AdminScope;
};

const historyPageSize = 20;
const resultsPageSize = 25;

export function useStorageIntegrity({
  onTaskIdChange,
  pollIntervalMs = 1_500,
  requestedTaskId,
  scope: requestedScope,
}: UseStorageIntegrityOptions) {
  const requestedWorkspaceId =
    requestedScope.kind === "workspace" ? requestedScope.workspaceId : null;
  const scope = useMemo(
    (): IntegrityAdminScope =>
      requestedScope.kind === "workspace" && requestedWorkspaceId
        ? { kind: "workspace", workspaceId: requestedWorkspaceId }
        : { kind: "all" },
    [requestedScope.kind, requestedWorkspaceId],
  );
  const scopeKey = serializeIntegrityScope(scope);
  const currentScopeKeyRef = useRef(scopeKey);
  const operationTokenRef = useRef<symbol | null>(null);
  const taskRef = useRef<StorageIntegrityTask | null>(null);
  const [task, setTaskState] = useState<StorageIntegrityTask | null>(null);
  const [history, setHistory] =
    useState<StorageIntegrityTasksResponse | null>(null);
  const [summary, setSummary] = useState<StorageIntegritySummary | null>(null);
  const [results, setResults] =
    useState<StorageIntegrityResultsResponse | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [resultsOffset, setResultsOffset] = useState(0);
  const [resultFilter, setResultFilterState] =
    useState<StorageIntegrityResultFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [loadingTask, setLoadingTask] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingResults, setLoadingResults] = useState(false);
  const [operationPending, setOperationPending] = useState(false);
  const [pendingAcknowledgementId, setPendingAcknowledgementId] = useState<
    string | null
  >(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [resultsRevision, setResultsRevision] = useState(0);

  const publishTask = useCallback((next: StorageIntegrityTask | null) => {
    taskRef.current = next;
    setTaskState(next);
    if (next) {
      setHistory((current) => patchTaskHistory(current, next));
    }
  }, []);

  useEffect(() => {
    currentScopeKeyRef.current = scopeKey;
  }, [scopeKey]);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      setHistoryOffset(0);
      setHistory(null);
      setResultsOffset(0);
      setResultFilterState("all");
      setResults(null);
      setSummary(null);
      setError(null);
      setPollError(null);
      operationTokenRef.current = null;
      setOperationPending(false);
      setPendingAcknowledgementId(null);
    });
    return () => {
      disposed = true;
    };
  }, [scopeKey]);

  useEffect(() => {
    const controller = new AbortController();
    const requestScopeKey = scopeKey;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) setLoadingSummary(true);
    });
    void fetchStorageIntegritySummary(scope, { signal: controller.signal })
      .then((nextSummary) => {
        if (disposed || currentScopeKeyRef.current !== requestScopeKey) return;
        setSummary(nextSummary);
      })
      .catch((requestError: unknown) => {
        if (disposed || isAbortError(requestError)) return;
        setError(errorMessage(requestError));
      })
      .finally(() => {
        if (!disposed && currentScopeKeyRef.current === requestScopeKey) {
          setLoadingSummary(false);
        }
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [historyRevision, scope, scopeKey]);

  useEffect(() => {
    const controller = new AbortController();
    const requestScopeKey = scopeKey;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) setLoadingHistory(true);
    });
    void fetchStorageIntegrityTasks(
      scope,
      { limit: historyPageSize, offset: historyOffset },
      { signal: controller.signal },
    )
      .then((page) => {
        if (disposed || currentScopeKeyRef.current !== requestScopeKey) return;
        setHistory(page);
      })
      .catch((requestError: unknown) => {
        if (disposed || isAbortError(requestError)) return;
        setError(errorMessage(requestError));
      })
      .finally(() => {
        if (!disposed && currentScopeKeyRef.current === requestScopeKey) {
          setLoadingHistory(false);
        }
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [historyOffset, historyRevision, scope, scopeKey]);

  useEffect(() => {
    const controller = new AbortController();
    const requestScopeKey = scopeKey;
    let disposed = false;

    if (!requestedTaskId) {
      queueMicrotask(() => {
        if (disposed) return;
        publishTask(null);
        setResults(null);
        setLoadingTask(false);
      });
      return () => {
        disposed = true;
        controller.abort();
      };
    }
    if (
      taskRef.current?.id === requestedTaskId &&
      isStorageIntegrityTaskVisible(taskRef.current, scope)
    ) {
      queueMicrotask(() => {
        if (!disposed) setLoadingTask(false);
      });
      return () => {
        disposed = true;
        controller.abort();
      };
    }

    queueMicrotask(() => {
      if (disposed) return;
      publishTask(null);
      setResults(null);
      setLoadingTask(true);
      setError(null);
      setPollError(null);
    });
    void fetchStorageIntegrityTask(requestedTaskId, {
      signal: controller.signal,
    })
      .then((restoredTask) => {
        if (disposed || currentScopeKeyRef.current !== requestScopeKey) return;
        if (!isStorageIntegrityTaskVisible(restoredTask, scope)) {
          setError("scope-mismatch");
          onTaskIdChange(null);
          return;
        }
        publishTask(restoredTask);
      })
      .catch((requestError: unknown) => {
        if (disposed || isAbortError(requestError)) return;
        setError(errorMessage(requestError));
        onTaskIdChange(null);
      })
      .finally(() => {
        if (!disposed && currentScopeKeyRef.current === requestScopeKey) {
          setLoadingTask(false);
        }
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [onTaskIdChange, publishTask, requestedTaskId, scope, scopeKey]);

  const polledTaskId = task?.id ?? null;
  const polledTaskStatus = task?.status ?? null;

  useEffect(() => {
    if (
      !polledTaskId ||
      (polledTaskStatus !== "queued" && polledTaskStatus !== "running")
    ) {
      return;
    }
    const requestScopeKey = scopeKey;
    const controller = new AbortController();
    let disposed = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = () => {
      timeoutId = setTimeout(() => {
        void fetchStorageIntegrityTask(polledTaskId, {
          signal: controller.signal,
        })
          .then((nextTask) => {
            if (
              disposed ||
              currentScopeKeyRef.current !== requestScopeKey ||
              !isStorageIntegrityTaskVisible(nextTask, scope)
            ) {
              return;
            }
            setPollError(null);
            publishTask(nextTask);
            setResultsRevision((value) => value + 1);
            if (nextTask.status === "queued" || nextTask.status === "running") {
              poll();
            } else {
              setHistoryRevision((value) => value + 1);
            }
          })
          .catch((requestError: unknown) => {
            if (!disposed && !isAbortError(requestError)) {
              setPollError(errorMessage(requestError));
              poll();
            }
          });
      }, pollIntervalMs);
    };
    poll();

    return () => {
      disposed = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    pollIntervalMs,
    polledTaskId,
    polledTaskStatus,
    publishTask,
    scope,
    scopeKey,
  ]);

  useEffect(() => {
    if (!task) {
      let disposed = false;
      queueMicrotask(() => {
        if (disposed) return;
        setResults(null);
        setLoadingResults(false);
      });
      return () => {
        disposed = true;
      };
    }
    const controller = new AbortController();
    const requestScopeKey = scopeKey;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) setLoadingResults(true);
    });
    void fetchStorageIntegrityResults(
      task.id,
      {
        limit: resultsPageSize,
        offset: resultsOffset,
        status: resultFilter,
      },
      { signal: controller.signal },
    )
      .then((page) => {
        if (disposed || currentScopeKeyRef.current !== requestScopeKey) return;
        setResults(page);
      })
      .catch((requestError: unknown) => {
        if (disposed || isAbortError(requestError)) return;
        setError(errorMessage(requestError));
      })
      .finally(() => {
        if (!disposed && currentScopeKeyRef.current === requestScopeKey) {
          setLoadingResults(false);
        }
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [resultFilter, resultsOffset, resultsRevision, scopeKey, task]);

  const start = useCallback(
    async (input: CreateStorageIntegrityTaskInput) => {
      if (operationTokenRef.current) return null;
      const requestScopeKey = scopeKey;
      const operationToken = Symbol("start-storage-integrity");
      operationTokenRef.current = operationToken;
      setOperationPending(true);
      setPendingAcknowledgementId(null);
      setError(null);
      setPollError(null);
      try {
        const nextTask = await createStorageIntegrityTask({
          ...input,
          scope: scope.kind,
          ...(scope.kind === "workspace"
            ? { workspaceId: scope.workspaceId }
            : { workspaceId: undefined }),
        });
        if (currentScopeKeyRef.current !== requestScopeKey) return null;
        if (!isStorageIntegrityTaskVisible(nextTask, scope)) {
          setError("scope-mismatch");
          return null;
        }
        publishTask(nextTask);
        setResults(null);
        setResultsOffset(0);
        setResultFilterState("all");
        setHistoryOffset(0);
        setHistoryRevision((value) => value + 1);
        onTaskIdChange(nextTask.id);
        return nextTask;
      } catch (requestError) {
        if (currentScopeKeyRef.current === requestScopeKey) {
          setError(errorMessage(requestError));
        }
        return null;
      } finally {
        if (operationTokenRef.current === operationToken) {
          operationTokenRef.current = null;
          if (currentScopeKeyRef.current === requestScopeKey) {
            setOperationPending(false);
          }
        }
      }
    },
    [onTaskIdChange, publishTask, scope, scopeKey],
  );

  const retry = useCallback(
    async (resultIds?: string[]) => {
      if (operationTokenRef.current) return null;
      const currentTask = taskRef.current;
      if (!currentTask) return null;
      const requestScopeKey = scopeKey;
      const operationToken = Symbol("retry-storage-integrity");
      operationTokenRef.current = operationToken;
      setOperationPending(true);
      setPendingAcknowledgementId(null);
      setError(null);
      setPollError(null);
      try {
        const nextTask = await retryStorageIntegrityTask(currentTask.id, {
          ...(resultIds?.length ? { resultIds } : {}),
        });
        if (currentScopeKeyRef.current !== requestScopeKey) return null;
        if (nextTask.id === currentTask.id) {
          setError("retry-reused-task");
          return null;
        }
        if (!isStorageIntegrityTaskVisible(nextTask, scope)) {
          setError("scope-mismatch");
          return null;
        }
        publishTask(nextTask);
        setResults(null);
        setResultsOffset(0);
        setResultFilterState("all");
        setHistoryOffset(0);
        setHistoryRevision((value) => value + 1);
        onTaskIdChange(nextTask.id);
        return nextTask;
      } catch (requestError) {
        if (currentScopeKeyRef.current === requestScopeKey) {
          setError(errorMessage(requestError));
        }
        return null;
      } finally {
        if (operationTokenRef.current === operationToken) {
          operationTokenRef.current = null;
          if (currentScopeKeyRef.current === requestScopeKey) {
            setOperationPending(false);
          }
        }
      }
    },
    [onTaskIdChange, publishTask, scope, scopeKey],
  );

  const acknowledge = useCallback(
    async (resultId: string): Promise<StorageIntegrityResult | null> => {
      if (operationTokenRef.current) return null;
      const currentTask = taskRef.current;
      if (!currentTask) return null;
      const requestScopeKey = scopeKey;
      const requestTaskId = currentTask.id;
      const operationToken = Symbol("acknowledge-storage-integrity");
      operationTokenRef.current = operationToken;
      setOperationPending(true);
      setPendingAcknowledgementId(resultId);
      setError(null);
      setPollError(null);
      try {
        const acknowledged = await acknowledgeStorageIntegrityResult(resultId);
        if (
          currentScopeKeyRef.current !== requestScopeKey ||
          taskRef.current?.id !== requestTaskId
        ) {
          return null;
        }
        if (
          acknowledged.id !== resultId ||
          acknowledged.taskId !== requestTaskId
        ) {
          setError("acknowledge-failed");
          return null;
        }
        setResults((current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.id === acknowledged.id ? acknowledged : item,
                ),
              }
            : current,
        );
        setResultsRevision((value) => value + 1);
        setHistoryRevision((value) => value + 1);
        return acknowledged;
      } catch {
        if (
          currentScopeKeyRef.current === requestScopeKey &&
          taskRef.current?.id === requestTaskId
        ) {
          setError("acknowledge-failed");
        }
        return null;
      } finally {
        if (operationTokenRef.current === operationToken) {
          operationTokenRef.current = null;
          if (currentScopeKeyRef.current === requestScopeKey) {
            setOperationPending(false);
            setPendingAcknowledgementId(null);
          }
        }
      }
    },
    [scopeKey],
  );

  const selectTask = useCallback(
    (taskId: string) => {
      if (taskId !== taskRef.current?.id) onTaskIdChange(taskId);
    },
    [onTaskIdChange],
  );

  const setResultFilter = useCallback(
    (filter: StorageIntegrityResultFilter) => {
      setResults(null);
      setLoadingResults(true);
      setResultFilterState(filter);
      setResultsOffset(0);
    },
    [],
  );

  const setResultsPage = useCallback((offset: number) => {
    setResults(null);
    setLoadingResults(true);
    setResultsOffset(offset);
  }, []);

  const refresh = useCallback(() => {
    const requestScopeKey = scopeKey;
    setError(null);
    setPollError(null);
    setHistoryRevision((value) => value + 1);
    if (taskRef.current) {
      const activeTaskId = taskRef.current.id;
      void fetchStorageIntegrityTask(activeTaskId)
        .then((nextTask) => {
          if (
            currentScopeKeyRef.current === requestScopeKey &&
            taskRef.current?.id === activeTaskId &&
            isStorageIntegrityTaskVisible(nextTask, scope)
          ) {
            publishTask(nextTask);
            setResultsRevision((value) => value + 1);
          }
        })
        .catch((requestError: unknown) => {
          if (
            currentScopeKeyRef.current === requestScopeKey &&
            taskRef.current?.id === activeTaskId
          ) {
            setError(errorMessage(requestError));
          }
        });
    }
  }, [publishTask, scope, scopeKey]);

  return {
    acknowledge,
    error: error ?? pollError,
    history,
    historyOffset,
    historyPageSize,
    loadingHistory,
    loadingResults,
    loadingSummary,
    loadingTask,
    operationPending,
    pendingAcknowledgementId,
    refresh,
    resultFilter,
    results,
    resultsOffset,
    resultsPageSize,
    retry,
    selectTask,
    setHistoryOffset,
    setResultFilter,
    setResultsOffset: setResultsPage,
    start,
    summary,
    task,
  };
}

export function isStorageIntegrityTaskVisible(
  task: StorageIntegrityTask,
  requestedScope: AdminScope,
) {
  const scope = normalizeIntegrityScope(requestedScope);
  return scope.kind === "all"
    ? task.scope === "all" && task.workspaceId === null
    : task.scope === "workspace" && task.workspaceId === scope.workspaceId;
}

function normalizeIntegrityScope(scope: AdminScope): IntegrityAdminScope {
  return scope.kind === "workspace" ? scope : { kind: "all" };
}

function serializeIntegrityScope(scope: IntegrityAdminScope) {
  return scope.kind === "workspace"
    ? `workspace:${scope.workspaceId}`
    : "all";
}

function patchTaskHistory(
  history: StorageIntegrityTasksResponse | null,
  task: StorageIntegrityTask,
) {
  if (!history) return history;
  const existingIndex = history.items.findIndex((item) => item.id === task.id);
  if (existingIndex < 0) return history;
  return {
    ...history,
    items: history.items.map((item, index) =>
      index === existingIndex ? task : item,
    ),
  };
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "request-failed";
}
