import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BatchOperationFailureDescription } from "./batch-operation-feedback";
import { getBatchOperationTone } from "./batch-operation-feedback-model";

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (
    values ? `${key}:${JSON.stringify(values)}` : key
  ),
}));

describe("batch operation feedback", () => {
  it("区分全成功、部分失败和全部失败语气", () => {
    expect(getBatchOperationTone({ failed: 0, requested: 3, succeeded: 3 })).toBe("success");
    expect(getBatchOperationTone({ failed: 2, requested: 5, succeeded: 3 })).toBe("warning");
    expect(getBatchOperationTone({ failed: 5, requested: 5, succeeded: 0 })).toBe("error");
  });

  it("最多显示六个文件名、保留完整标题并汇总剩余数量", () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `internal-${index}`,
      name: index === 0 ? "一份非常长、需要在通知中截断显示的季度汇总文件名称.xlsx" : `文件-${index}.txt`,
    }));
    const failures = items.map((item) => ({ id: item.id, message: "locked" }));

    render(<BatchOperationFailureDescription failures={failures} items={items} />);

    expect(screen.getByTitle(items[0].name)).toHaveTextContent(items[0].name);
    expect(screen.getAllByTitle(/.+/)).toHaveLength(6);
    expect(screen.getByText('files.batchFailureMore:{"count":2}')).toBeInTheDocument();
    expect(screen.queryByText("internal-7")).not.toBeInTheDocument();
  });

  it("找不到名称时使用本地化兜底而不暴露内部 ID", () => {
    render(
      <BatchOperationFailureDescription
        failures={[{ id: "private-uuid", message: "locked" }]}
        items={[]}
      />,
    );

    expect(screen.getByTitle("files.unknownItem")).toBeInTheDocument();
    expect(screen.queryByText("private-uuid")).not.toBeInTheDocument();
  });
});
