"use client";

import { useMemo, useState, type FormEvent } from "react";
import { AppInput } from "@/components/ui/app-input";
import { LocalIcon } from "@/components/ui/app-icon";
import { AppSelect } from "@/components/ui/app-select";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { ToolButton } from "@/components/ui/tool-button";
import { AdminStorageIntegrityTarget } from "./admin-storage-integrity-target";
import type { AdminScope } from "@/features/admin/admin-scope";
import { storageIntegrityStatusTextColor } from "@/features/admin/storage-integrity-colors";
import { useStorageIntegrity } from "@/features/admin/use-storage-integrity";
import {
  formatFileSize,
  getIntlLocale,
  type Locale,
  type Palette,
} from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import type {
  CreateStorageIntegrityTaskInput,
  StorageIntegrityResult,
  StorageIntegrityResultFilter,
  StorageIntegrityTarget,
  StorageIntegrityTask,
} from "@/lib/drive-api";
import "./admin-storage-integrity-panel.css";

export function AdminStorageIntegrityPanel({
  locale,
  onTaskIdChange,
  palette,
  requestedTaskId,
  scope,
  timeZone,
}: {
  locale: Locale;
  onTaskIdChange: (taskId: string | null) => void;
  palette: Palette;
  requestedTaskId: string | null;
  scope: AdminScope;
  timeZone: string;
}) {
  const t = useTranslations();
  const controller = useStorageIntegrity({
    onTaskIdChange,
    requestedTaskId,
    scope,
  });
  const [mode, setMode] = useState<"backfill" | "verify">("verify");
  const [batchSize, setBatchSize] = useState("100");
  const [concurrency, setConcurrency] = useState("2");
  const [bandwidthMib, setBandwidthMib] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("3");
  const workspaceId = scope.kind === "workspace" ? scope.workspaceId : null;
  const integrityScope = useMemo(
    () =>
      workspaceId
        ? ({ kind: "workspace", workspaceId } as const)
        : ({ kind: "all" } as const),
    [workspaceId],
  );
  const integrityScopeKey = workspaceId ? `workspace:${workspaceId}` : "all";
  const [targetState, setTargetState] = useState<{
    scopeKey: string;
    target: StorageIntegrityTarget;
  }>({ scopeKey: integrityScopeKey, target: {} });
  const target =
    targetState.scopeKey === integrityScopeKey
      ? targetState.target
      : emptyIntegrityTarget;
  const [confirmation, setConfirmation] = useState({
    checked: false,
    scopeKey: integrityScopeKey,
  });
  const confirmAll =
    confirmation.scopeKey === integrityScopeKey && confirmation.checked;
  const globalRun = integrityScope.kind === "all";

  const formInput = useMemo<CreateStorageIntegrityTaskInput>(
    () => ({
      batchSize: boundedInteger(batchSize, 1, 500, 100),
      bandwidthLimitBytesPerSecond: bandwidthMib.trim()
        ? boundedInteger(bandwidthMib, 1, maxBandwidthMib, 1) * 1024 * 1024
        : null,
      concurrency: boundedInteger(concurrency, 1, 8, 2),
      maxAttempts: boundedInteger(maxAttempts, 1, 10, 3),
      mode,
      scope: integrityScope.kind,
      ...(integrityScope.kind === "workspace"
        ? { workspaceId: integrityScope.workspaceId }
        : {}),
      ...(target.nodeId || target.versionId ? { target } : {}),
    }),
    [
      bandwidthMib,
      batchSize,
      concurrency,
      integrityScope,
      maxAttempts,
      mode,
      target,
    ],
  );

  const startDisabled =
    controller.operationPending || (globalRun && !confirmAll);
  const progressMax = Math.max(controller.task?.progress.total ?? 0, 1);
  const progressValue = Math.min(
    controller.task?.progress.processed ?? 0,
    progressMax,
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTask();
  };

  const startTask = () => {
    if (startDisabled) return;
    void controller.start(formInput);
  };

  return (
    <section
      aria-busy={
        controller.loadingSummary ||
        controller.loadingHistory ||
        controller.loadingTask ||
        undefined
      }
      aria-label={t("storageIntegrity.title")}
      className="admin-integrity"
    >
      <header className="admin-integrity-commandbar">
        <div>
          <span className="admin-integrity-kicker">
            {t("storageIntegrity.kicker")}
          </span>
          <h1>{t("storageIntegrity.title")}</h1>
          <p>{t("storageIntegrity.subtitle")}</p>
        </div>
        <ToolButton
          isPending={
            controller.loadingHistory || controller.loadingSummary
          }
          label={t("actions.refresh")}
          onClick={controller.refresh}
          palette={palette}
          visual="surface"
        >
          <LocalIcon name="refresh" size={17} />
        </ToolButton>
      </header>

      <div className="admin-integrity-summary" aria-label={t("storageIntegrity.summary")}>
        <SummaryMetric
          count={controller.summary?.counts.unknown}
          label={t("storageIntegrity.count.unknown")}
          loading={controller.loadingSummary}
          testId="integrity-count-unknown"
          tone="neutral"
        />
        <SummaryMetric
          count={controller.summary?.counts.pending}
          label={t("storageIntegrity.count.pending")}
          loading={controller.loadingSummary}
          testId="integrity-count-pending"
          tone="info"
        />
        <SummaryMetric
          count={controller.summary?.counts.verified}
          label={t("storageIntegrity.count.verified")}
          loading={controller.loadingSummary}
          testId="integrity-count-verified"
          tone="success"
        />
        <SummaryMetric
          count={controller.summary?.counts.mismatch}
          label={t("storageIntegrity.count.mismatch")}
          loading={controller.loadingSummary}
          testId="integrity-count-mismatch"
          tone="warning"
        />
        <SummaryMetric
          count={controller.summary?.counts.failed}
          label={t("storageIntegrity.count.failed")}
          loading={controller.loadingSummary}
          testId="integrity-count-failed"
          tone="danger"
        />
      </div>

      <div className="admin-integrity-timestamp">
        <LocalIcon name="clock" size={14} />
        <span>
          {t("storageIntegrity.lastVerifiedAt", {
            time: formatTimestamp(
              controller.summary?.lastVerifiedAt,
              locale,
              timeZone,
            ),
          })}
        </span>
      </div>

      {controller.error ? (
        <div className="admin-integrity-alert" role="alert">
          <LocalIcon name="exclamation" size={16} />
          <span>{translateControllerError(controller.error, t)}</span>
        </div>
      ) : null}

      <section className="admin-integrity-zone" aria-labelledby="integrity-run-heading">
        <div className="admin-integrity-zone-heading">
          <span><LocalIcon name="play" size={17} /></span>
          <div>
            <h3 id="integrity-run-heading">{t("storageIntegrity.newTask")}</h3>
            <p>{t("storageIntegrity.newTaskHint")}</p>
          </div>
        </div>
        <form className="admin-integrity-form" onSubmit={submit}>
          <label>
            <span>{t("storageIntegrity.modeLabel")}</span>
            <AppSelect
              aria-label={t("storageIntegrity.modeLabel")}
              onChange={(event) =>
                setMode(event.target.value as "backfill" | "verify")
              }
              options={[
                { label: t("storageIntegrity.mode.verify"), value: "verify" },
                {
                  label: t("storageIntegrity.mode.backfill"),
                  value: "backfill",
                },
              ]}
              palette={palette}
              value={mode}
            />
          </label>
          <NumberField
            label={t("storageIntegrity.batchSize")}
            max={500}
            min={1}
            onChange={setBatchSize}
            palette={palette}
            required
            value={batchSize}
          />
          <NumberField
            label={t("storageIntegrity.concurrency")}
            max={8}
            min={1}
            onChange={setConcurrency}
            palette={palette}
            required
            value={concurrency}
          />
          <NumberField
            label={t("storageIntegrity.bandwidthMib")}
            max={maxBandwidthMib}
            min={1}
            onChange={setBandwidthMib}
            palette={palette}
            placeholder={t("storageIntegrity.unlimited")}
            value={bandwidthMib}
          />
          <NumberField
            label={t("storageIntegrity.maxAttempts")}
            max={10}
            min={1}
            onChange={setMaxAttempts}
            palette={palette}
            required
            value={maxAttempts}
          />
          {integrityScope.kind === "workspace" ? (
            <AdminStorageIntegrityTarget
              locale={locale}
              onChange={(nextTarget) =>
                setTargetState({
                  scopeKey: integrityScopeKey,
                  target: nextTarget,
                })
              }
              palette={palette}
              scope={integrityScope}
              value={target}
            />
          ) : (
            <div className="admin-integrity-target-unavailable">
              <LocalIcon name="info" size={15} />
              <span>{t("storageIntegrity.targetWorkspaceOnly")}</span>
            </div>
          )}
          <div className="admin-integrity-submit">
            {globalRun ? (
              <label className="admin-integrity-confirm">
                <input
                  aria-label={t("storageIntegrity.confirmAll")}
                  checked={confirmAll}
                  onChange={(event) =>
                    setConfirmation({
                      checked: event.target.checked,
                      scopeKey: integrityScopeKey,
                    })
                  }
                  type="checkbox"
                />
                <span>{t("storageIntegrity.confirmAll")}</span>
              </label>
            ) : (
              <span className="admin-integrity-scope-note">
                {t("storageIntegrity.workspaceRun")}
              </span>
            )}
            <ToolButton
              disabled={startDisabled}
              isPending={controller.operationPending}
              label={t("storageIntegrity.start")}
              palette={palette}
              tone="accent"
              type="submit"
              visual="surface"
            >
              <LocalIcon name="play" size={17} />
            </ToolButton>
          </div>
        </form>
      </section>

      <section className="admin-integrity-zone" aria-labelledby="integrity-current-heading">
        <div className="admin-integrity-zone-heading admin-integrity-zone-heading-actions">
          <span><LocalIcon name="shield" size={17} /></span>
          <div>
            <h3 id="integrity-current-heading">{t("storageIntegrity.currentTask")}</h3>
            <p>{t("storageIntegrity.currentTaskHint")}</p>
          </div>
          {controller.task && canRetry(controller.task) ? (
            <ToolButton
              disabled={controller.operationPending}
              isPending={controller.operationPending}
              label={t("storageIntegrity.retryAll")}
              onClick={() => void controller.retry()}
              palette={palette}
              visual="surface"
            >
              <LocalIcon name="refresh" size={16} />
            </ToolButton>
          ) : null}
        </div>
        {controller.loadingTask && !controller.task ? (
          <div className="admin-integrity-empty" role="status">
            {t("app.loading")}
          </div>
        ) : controller.task ? (
          <TaskProgress
            locale={locale}
            palette={palette}
            progressMax={progressMax}
            progressValue={progressValue}
            task={controller.task}
            timeZone={timeZone}
          />
        ) : (
          <div className="admin-integrity-empty">
            {t("storageIntegrity.noCurrentTask")}
          </div>
        )}
      </section>

      <section className="admin-integrity-zone" aria-labelledby="integrity-results-heading">
        <div className="admin-integrity-zone-heading admin-integrity-zone-heading-actions">
          <span><LocalIcon name="search" size={17} /></span>
          <div>
            <h3 id="integrity-results-heading">{t("storageIntegrity.findings")}</h3>
            <p>{t("storageIntegrity.findingsHint")}</p>
          </div>
          <AppSelect
            aria-label={t("storageIntegrity.resultFilter")}
            disabled={!controller.task}
            onChange={(event) =>
              controller.setResultFilter(
                event.target.value as StorageIntegrityResultFilter,
              )
            }
            options={resultFilterOptions.map((value) => ({
              label: t(`storageIntegrity.result.${value}`),
              value,
            }))}
            palette={palette}
            value={controller.resultFilter}
          />
        </div>
        <IntegrityResults
          items={controller.results?.items ?? []}
          loading={controller.loadingResults}
          locale={locale}
          onAcknowledge={(id) => void controller.acknowledge(id)}
          onRetry={(id) => void controller.retry([id])}
          operationPending={controller.operationPending}
          palette={palette}
          pendingAcknowledgementId={controller.pendingAcknowledgementId}
          taskStatus={controller.task?.status ?? null}
          timeZone={timeZone}
        />
        <Pagination
          disabled={controller.loadingResults}
          label={t("storageIntegrity.findings")}
          limit={controller.resultsPageSize}
          offset={controller.resultsOffset}
          onOffsetChange={controller.setResultsOffset}
          palette={palette}
          total={controller.results?.total ?? 0}
        />
      </section>

      <section className="admin-integrity-zone" aria-labelledby="integrity-history-heading">
        <div className="admin-integrity-zone-heading">
          <span><LocalIcon name="time" size={17} /></span>
          <div>
            <h3 id="integrity-history-heading">{t("storageIntegrity.history")}</h3>
            <p>{t("storageIntegrity.historyHint")}</p>
          </div>
        </div>
        <TaskHistory
          activeTaskId={controller.task?.id ?? null}
          items={controller.history?.items ?? []}
          loading={controller.loadingHistory}
          locale={locale}
          onSelect={controller.selectTask}
          timeZone={timeZone}
        />
        <Pagination
          disabled={controller.loadingHistory}
          label={t("storageIntegrity.history")}
          limit={controller.historyPageSize}
          offset={controller.historyOffset}
          onOffsetChange={controller.setHistoryOffset}
          palette={palette}
          total={controller.history?.total ?? 0}
        />
      </section>
    </section>
  );
}

function SummaryMetric({
  count,
  label,
  loading,
  testId,
  tone,
}: {
  count: number | undefined;
  label: string;
  loading: boolean;
  testId: string;
  tone: string;
}) {
  return (
    <div data-testid={testId} data-tone={tone}>
      <span>{label}</span>
      <strong>{loading && count === undefined ? "--" : (count ?? 0)}</strong>
    </div>
  );
}

function NumberField({
  label,
  max,
  min,
  onChange,
  palette,
  placeholder,
  required,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: string) => void;
  palette: Palette;
  placeholder?: string;
  required?: boolean;
  value: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <AppInput
        aria-label={label}
        inputMode="numeric"
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        palette={palette}
        placeholder={placeholder}
        required={required}
        type="number"
        value={value}
      />
    </label>
  );
}

function TaskProgress({
  locale,
  palette,
  progressMax,
  progressValue,
  task,
  timeZone,
}: {
  locale: Locale;
  palette: Palette;
  progressMax: number;
  progressValue: number;
  task: StorageIntegrityTask;
  timeZone: string;
}) {
  const t = useTranslations();
  return (
    <div className="admin-integrity-progress" aria-live="polite">
      <div className="admin-integrity-task-line">
        <code title={task.id}>{task.id}</code>
        <span
          data-status={task.status}
          style={{ color: storageIntegrityStatusTextColor(palette, task.status) }}
        >
          {t(`storageIntegrity.status.${task.status}`)}
        </span>
        <span>{t(`storageIntegrity.mode.${task.mode}`)}</span>
        <time>{formatTimestamp(task.startedAt ?? task.createdAt, locale, timeZone)}</time>
      </div>
      <ProgressMeter
        ariaLabel={t("storageIntegrity.progress")}
        max={progressMax}
        palette={palette}
        value={progressValue}
      />
      <div className="admin-integrity-progress-facts">
        <ProgressFact
          label={t("storageIntegrity.processed")}
          value={`${task.progress.processed} / ${task.progress.total}`}
        />
        <ProgressFact
          label={t("storageIntegrity.matched")}
          value={String(task.progress.matched)}
        />
        <ProgressFact
          label={t("storageIntegrity.mismatches")}
          value={String(task.progress.mismatches)}
        />
        <ProgressFact
          label={t("storageIntegrity.failed")}
          value={String(task.progress.failed)}
        />
        <ProgressFact
          label={t("storageIntegrity.bytesRead")}
          value={formatFileSize(task.progress.bytesRead, locale)}
        />
      </div>
      {task.failureCode || task.failureMessage ? (
        <div
          className="admin-integrity-task-error"
          role="alert"
          style={{ color: storageIntegrityStatusTextColor(palette, "failed") }}
        >
          {t(storageIntegrityFailureMessageKey(task.failureCode))}
        </div>
      ) : null}
    </div>
  );
}

function ProgressFact({ label, value }: { label: string; value: string }) {
  return <span><small>{label}</small><strong>{value}</strong></span>;
}

function IntegrityResults({
  items,
  loading,
  locale,
  onAcknowledge,
  onRetry,
  operationPending,
  palette,
  pendingAcknowledgementId,
  taskStatus,
  timeZone,
}: {
  items: StorageIntegrityResult[];
  loading: boolean;
  locale: Locale;
  onAcknowledge: (id: string) => void;
  onRetry: (id: string) => void;
  operationPending: boolean;
  palette: Palette;
  pendingAcknowledgementId: string | null;
  taskStatus: StorageIntegrityTask["status"] | null;
  timeZone: string;
}) {
  const t = useTranslations();
  if (loading && items.length === 0) {
    return <div className="admin-integrity-empty" role="status">{t("app.loading")}</div>;
  }
  if (items.length === 0) {
    return (
      <div className="admin-integrity-empty">
        {taskStatus
          ? t("storageIntegrity.noFindings")
          : t("storageIntegrity.selectTask")}
      </div>
    );
  }
  return (
    <div className="admin-integrity-table-scroll">
      <table className="admin-integrity-table">
        <thead>
          <tr>
            <th>{t("storageIntegrity.object")}</th>
            <th>{t("storageIntegrity.resultLabel")}</th>
            <th>{t("storageIntegrity.expected")}</th>
            <th>{t("storageIntegrity.actual")}</th>
            <th>{t("storageIntegrity.checkedAt")}</th>
            <th><span className="sr-only">{t("transfers.actions")}</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr data-status={item.status} key={item.id}>
              <td>
                <span className="admin-integrity-object" title={item.objectKey}>
                  {item.objectKey}
                </span>
                <span className="admin-integrity-object-references">
                  <small>
                    <span>{t("storageIntegrity.nodeId")}</span>
                    <code title={item.nodeId ?? undefined}>
                      {item.nodeId ?? "--"}
                    </code>
                  </small>
                  <small>
                    <span>{t("storageIntegrity.versionId")}</span>
                    <code title={item.versionId ?? undefined}>
                      {item.versionId ?? "--"}
                    </code>
                  </small>
                </span>
              </td>
              <td>
                <div className="admin-integrity-result-state">
                  <span
                    className="admin-integrity-result"
                    data-status={item.status}
                    style={{
                      color: storageIntegrityStatusTextColor(
                        palette,
                        item.status,
                      ),
                    }}
                  >
                    {t(`storageIntegrity.result.${item.status}`)}
                  </span>
                  {item.acknowledgedAt ? (
                    <span
                      aria-label={t("storageIntegrity.acknowledgedAt", {
                        time: formatTimestamp(
                          item.acknowledgedAt,
                          locale,
                          timeZone,
                        ),
                      })}
                      className="admin-integrity-acknowledged"
                    >
                      <LocalIcon name="tick" size={12} />
                      <span>{t("storageIntegrity.acknowledged")}</span>
                      <time dateTime={item.acknowledgedAt}>
                        {formatTimestamp(
                          item.acknowledgedAt,
                          locale,
                          timeZone,
                        )}
                      </time>
                    </span>
                  ) : null}
                </div>
              </td>
              <td>
                <code title={item.expectedHash ?? undefined}>{item.expectedHash ?? "--"}</code>
                <small data-testid="integrity-expected-size">{formatFileSize(item.expectedSizeBytes, locale)}</small>
              </td>
              <td>
                <code title={item.actualHash ?? undefined}>{item.actualHash ?? "--"}</code>
                <small data-testid="integrity-actual-size">{formatFileSize(item.actualSizeBytes, locale)}</small>
              </td>
              <td>
                <time>{formatTimestamp(item.checkedAt, locale, timeZone)}</time>
                <small>{t("storageIntegrity.attempts", { count: item.attempts })}</small>
              </td>
              <td>
                <div className="admin-integrity-result-actions">
                  {canAcknowledge(item) ? (
                    <ToolButton
                      disabled={operationPending}
                      isPending={pendingAcknowledgementId === item.id}
                      label={t("storageIntegrity.acknowledgeFinding")}
                      onClick={() => onAcknowledge(item.id)}
                      palette={palette}
                      tone="success"
                      visual="surface"
                    >
                      <LocalIcon name="tick" size={15} />
                    </ToolButton>
                  ) : null}
                  {item.status === "matched" ||
                  !canRetryFinding(taskStatus) ? null : (
                    <ToolButton
                      disabled={operationPending}
                      label={t("storageIntegrity.retryFinding")}
                      onClick={() => onRetry(item.id)}
                      palette={palette}
                    >
                      <LocalIcon name="refresh" size={15} />
                    </ToolButton>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskHistory({
  activeTaskId,
  items,
  loading,
  locale,
  onSelect,
  timeZone,
}: {
  activeTaskId: string | null;
  items: StorageIntegrityTask[];
  loading: boolean;
  locale: Locale;
  onSelect: (taskId: string) => void;
  timeZone: string;
}) {
  const t = useTranslations();
  if (loading && items.length === 0) {
    return <div className="admin-integrity-empty" role="status">{t("app.loading")}</div>;
  }
  if (items.length === 0) {
    return <div className="admin-integrity-empty">{t("storageIntegrity.noHistory")}</div>;
  }
  return (
    <div className="admin-integrity-history-list">
      {items.map((item) => (
        <button
          aria-current={activeTaskId === item.id ? "true" : undefined}
          aria-describedby={`integrity-task-${item.id}-status integrity-task-${item.id}-progress`}
          aria-label={t("storageIntegrity.openTask", { task: item.id })}
          data-active={activeTaskId === item.id ? "true" : undefined}
          key={item.id}
          onClick={() => onSelect(item.id)}
          type="button"
        >
          <span
            className="admin-integrity-history-icon"
            data-status={taskVisualStatus(item)}
          >
            <LocalIcon name={taskStatusIcon(item)} size={15} />
          </span>
          <span>
            <code title={item.id}>{item.id}</code>
            <small>{formatTimestamp(item.createdAt, locale, timeZone)}</small>
          </span>
          <span>{t(`storageIntegrity.mode.${item.mode}`)}</span>
          <strong
            data-status={item.status}
            id={`integrity-task-${item.id}-status`}
          >
            {t(`storageIntegrity.status.${item.status}`)}
          </strong>
          <span id={`integrity-task-${item.id}-progress`}>
            {item.progress.processed} / {item.progress.total}
          </span>
          <LocalIcon name="arrow_right" size={14} />
        </button>
      ))}
    </div>
  );
}

function Pagination({
  disabled,
  label,
  limit,
  offset,
  onOffsetChange,
  palette,
  total,
}: {
  disabled: boolean;
  label: string;
  limit: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  palette: Palette;
  total: number;
}) {
  const t = useTranslations();
  if (total <= limit && offset === 0) return null;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  return (
    <div className="admin-integrity-pagination">
      <span>{t("storageIntegrity.pageRange", { end, start, total })}</span>
      <div>
        <ToolButton
          disabled={disabled || offset === 0}
          label={t("storageIntegrity.previousPage", { section: label })}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
          palette={palette}
        >
          <LocalIcon name="arrow_left" size={15} />
        </ToolButton>
        <ToolButton
          disabled={disabled || offset + limit >= total}
          label={t("storageIntegrity.nextPage", { section: label })}
          onClick={() => onOffsetChange(offset + limit)}
          palette={palette}
        >
          <LocalIcon name="arrow_right" size={15} />
        </ToolButton>
      </div>
    </div>
  );
}

const resultFilterOptions: StorageIntegrityResultFilter[] = [
  "all",
  "matched",
  "mismatch",
  "failed",
];
const maxBandwidthMib = Math.floor(1_000_000_000 / (1024 * 1024));
const emptyIntegrityTarget: StorageIntegrityTarget = {};

function canRetry(task: StorageIntegrityTask) {
  return (
    task.status === "failed" ||
    (task.status === "completed" &&
      (task.progress.mismatches > 0 || task.progress.failed > 0))
  );
}

function canAcknowledge(result: StorageIntegrityResult) {
  return (
    !result.acknowledgedAt &&
    (result.status === "mismatch" || result.status === "failed")
  );
}

function canRetryFinding(status: StorageIntegrityTask["status"] | null) {
  return status !== null && status !== "queued" && status !== "running";
}

function taskVisualStatus(task: StorageIntegrityTask) {
  if (task.status !== "completed") return task.status;
  if (task.progress.failed > 0) return "failed" as const;
  if (task.progress.mismatches > 0) return "mismatch" as const;
  return task.status;
}

function taskStatusIcon(task: StorageIntegrityTask) {
  if (task.status === "completed") {
    return task.progress.mismatches === 0 && task.progress.failed === 0
      ? "tick" as const
      : "exclamation" as const;
  }
  if (task.status === "failed") return "exclamation" as const;
  if (task.status === "running" || task.status === "queued") return "time" as const;
  return "info" as const;
}

function storageIntegrityFailureMessageKey(code: string | null | undefined) {
  if (code === "STORAGE_INTEGRITY_LEASE_LOST") {
    return "storageIntegrity.failure.leaseLost";
  }
  if (code === "STORAGE_INTEGRITY_TASK_FAILED") {
    return "storageIntegrity.failure.taskFailed";
  }
  return "storageIntegrity.failure.unknown";
}

function boundedInteger(value: string, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function formatTimestamp(
  value: string | null | undefined,
  locale: Locale,
  timeZone: string,
) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

function translateControllerError(
  error: string,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (error === "scope-mismatch") return t("storageIntegrity.scopeMismatch");
  if (error === "retry-reused-task") return t("storageIntegrity.retryReusedTask");
  if (error === "acknowledge-failed") {
    return t("storageIntegrity.acknowledgeFailed");
  }
  return t("storageIntegrity.loadFailed");
}
