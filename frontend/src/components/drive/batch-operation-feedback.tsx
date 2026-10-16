import type { DriveItem } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import type { BatchOperationFailure } from "./batch-operation-feedback-model";

export function BatchOperationFailureDescription({
  failures,
  items,
}: {
  failures: BatchOperationFailure[];
  items: Array<Pick<DriveItem, "id" | "name">>;
}) {
  const t = useTranslations();
  const namesById = new Map(items.map((item) => [item.id, item.name]));
  const visibleFailures = failures.slice(0, 6);
  const remainingCount = Math.max(0, failures.length - visibleFailures.length);

  return (
    <span className="batch-operation-failures">
      {visibleFailures.map((failure, index) => {
        const name = namesById.get(failure.id) ?? t("files.unknownItem");
        return (
          <span className="batch-operation-failure" key={`${failure.id}-${index}`}>
            <span className="batch-operation-failure-name" title={name}>{name}</span>
            <span aria-hidden="true" className="batch-operation-failure-separator">:</span>
            <span className="batch-operation-failure-message">{failure.message}</span>
          </span>
        );
      })}
      {remainingCount > 0 ? (
        <span className="batch-operation-failure-more">
          {t("files.batchFailureMore", { count: remainingCount })}
        </span>
      ) : null}
    </span>
  );
}
