import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSystemStatus } from "./admin-system-status";

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string) => key,
}));

afterEach(cleanup);

describe("AdminSystemStatus", () => {
  it("keeps system information separate from health and workspace storage", () => {
    render(
      <AdminSystemStatus
        locale="en"
        systemOverview={{
          apiName: "ICEDR API",
          appPrereleaseLabel: null,
          appReleaseChannel: "stable",
          appVersion: "1.2.3",
          appVersionTag: "v1.2.3",
          architecture: "x64",
          loadAverage: [0.1, 0.2, 0.3],
          memoryFreeBytes: 3_000,
          memoryTotalBytes: 4_000,
          memoryUsagePercent: 25,
          nodeVersion: "v24.0.0",
          operatingSystem: "linux",
          osPlatform: "linux",
          osRelease: "6.8",
          osUptimeSeconds: 3600,
          processUptimeSeconds: 1800,
          runtime: "Node.js",
          serviceStartedAt: "2026-08-13T00:00:00.000Z",
          updatedAt: "2026-08-13T01:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("settings.systemInformation")).toBeInTheDocument();
    expect(screen.getAllByText("v1.2.3")).toHaveLength(2);
    expect(screen.queryByText("settings.runningStatus")).not.toBeInTheDocument();
    expect(screen.queryByText("settings.storageSpace")).not.toBeInTheDocument();
  });
});
