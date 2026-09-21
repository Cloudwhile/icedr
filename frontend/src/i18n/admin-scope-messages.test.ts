import { describe, expect, it } from "vitest";
import { translateLocaleMessage } from "./messages";

describe("admin scope messages", () => {
  it("describes all scope as global workspace and system data", () => {
    expect(translateLocaleMessage("zh", "admin.scopeAll")).toBe(
      "全局（所有工作区与系统）",
    );
    expect(translateLocaleMessage("en", "admin.scopeAll")).toBe(
      "Global (all workspaces and system)",
    );
  });

  it("keeps storage integrity labels and mode options independently translatable", () => {
    expect(translateLocaleMessage("zh", "storageIntegrity.title")).toBe(
      "存储完整性",
    );
    expect(translateLocaleMessage("zh", "storageIntegrity.modeLabel")).toBe(
      "模式",
    );
    expect(
      translateLocaleMessage("en", "storageIntegrity.mode.verify"),
    ).toBe("Verify stored objects");
  });

  it("localizes stable storage integrity failure codes without backend copy", () => {
    expect(
      translateLocaleMessage("en", "storageIntegrity.failure.taskFailed"),
    ).toBe("The integrity check could not be completed.");
    expect(
      translateLocaleMessage("zh", "storageIntegrity.failure.leaseLost"),
    ).toBe("任务租约已过期，完整性检查未能完成。");
  });

  it("provides natural acknowledgement actions and status labels", () => {
    expect(
      translateLocaleMessage("en", "storageIntegrity.acknowledgeFinding"),
    ).toBe("Acknowledge anomaly and allow automatic cleanup");
    expect(
      translateLocaleMessage("zh", "storageIntegrity.acknowledgeFailed"),
    ).toBe("无法确认该异常，请重试。");
    expect(
      translateLocaleMessage("zh", "storageIntegrity.acknowledgedAt"),
    ).toBe("已于 {time} 确认");
    expect(
      translateLocaleMessage("zh", "storageIntegrity.findingsHint"),
    ).toBe("展示哈希与大小证据；未确认的异常不会被自动清理");
  });
});
