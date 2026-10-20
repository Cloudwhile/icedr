import { formatFileSize, type Locale } from "@/features/file/model";

export function UsageBreakdownList({
  items,
  locale,
  title,
}: {
  items: Array<{ bytes: number; count: number; id: string; label: string }>;
  locale: Locale;
  title: string;
}) {
  return (
    <section
      aria-label={title}
      className="drive-system-breakdown-panel drive-system-breakdown-list"
      tabIndex={0}
    >
      <span>{title}</span>
      {items.map((item) => (
        <div key={item.id}>
          <span className="icedr-truncate" title={item.label}>{item.label}</span>
          <span>{formatFileSize(item.bytes, locale)}</span>
        </div>
      ))}
      {items.length === 0 ? (
        <div>
          <span>--</span>
          <span>--</span>
        </div>
      ) : null}
    </section>
  );
}
