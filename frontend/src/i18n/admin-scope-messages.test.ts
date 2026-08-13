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
});
