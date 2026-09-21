import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import { AdminScopeSelector } from "./admin-scope-selector";

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string) => key,
}));

afterEach(cleanup);

describe("AdminScopeSelector", () => {
  it("can exclude system scope from sections that only support all/workspace", () => {
    render(
      <AdminScopeSelector
        includeSystem={false}
        onChange={vi.fn()}
        palette={palettes.light}
        scope={{ kind: "all" }}
        workspaces={[{ id: "workspace-1", name: "Operations" }]}
      />,
    );

    const options = screen.getAllByRole("option").map((option) => option.getAttribute("value"));
    expect(options).toEqual(["scope:all", "workspace:workspace-1"]);
  });
});
