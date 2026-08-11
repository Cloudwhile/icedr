export const driveRefreshTargets = [
  "files",
  "shares",
  "shareSettings",
  "transfers",
  "storage",
] as const;

export type DriveRefreshTarget = (typeof driveRefreshTargets)[number];

export type DriveRefreshOutcome =
  | { status: "success"; target: DriveRefreshTarget }
  | { message: string; stale: boolean; status: "failed"; target: DriveRefreshTarget }
  | { status: "superseded"; target: DriveRefreshTarget }
  | { status: "skipped"; target: DriveRefreshTarget };

export type DriveRefreshSummary = {
  failed: Extract<DriveRefreshOutcome, { status: "failed" }>[];
  incomplete: Extract<DriveRefreshOutcome, { status: "skipped" | "superseded" }>[];
  status: "success" | "partial" | "failed";
  succeeded: DriveRefreshTarget[];
};

export function driveRefreshSucceeded(target: DriveRefreshTarget): DriveRefreshOutcome {
  return { status: "success", target };
}

export function driveRefreshFailed(
  target: DriveRefreshTarget,
  message: string,
  stale: boolean,
): DriveRefreshOutcome {
  return { message, stale, status: "failed", target };
}

export function driveRefreshSuperseded(target: DriveRefreshTarget): DriveRefreshOutcome {
  return { status: "superseded", target };
}

export function driveRefreshSkipped(target: DriveRefreshTarget): DriveRefreshOutcome {
  return { status: "skipped", target };
}

export function summarizeDriveRefresh(outcomes: DriveRefreshOutcome[]): DriveRefreshSummary {
  const succeeded = outcomes
    .filter((outcome): outcome is Extract<DriveRefreshOutcome, { status: "success" }> => outcome.status === "success")
    .map((outcome) => outcome.target);
  const failed = outcomes.filter(
    (outcome): outcome is Extract<DriveRefreshOutcome, { status: "failed" }> => outcome.status === "failed",
  );
  const incomplete = outcomes.filter(
    (outcome): outcome is Extract<DriveRefreshOutcome, { status: "skipped" | "superseded" }> => (
      outcome.status === "skipped" || outcome.status === "superseded"
    ),
  );

  return {
    failed,
    incomplete,
    status: failed.length === 0
      ? "success"
      : succeeded.length > 0
        ? "partial"
        : "failed",
    succeeded,
  };
}
