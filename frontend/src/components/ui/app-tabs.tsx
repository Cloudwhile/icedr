"use client";

type AppTabsProps<T extends string> = {
  id: string;
  label: string;
  className?: string;
  tabs: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
};

export function AppTabs<T extends string>({ id, label, className, tabs, value, onChange }: AppTabsProps<T>) {
  return (
    <div className={className} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          id={`${id}-tab-${tab.value}`}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          aria-controls={`${id}-panel-${tab.value}`}
          tabIndex={value === tab.value ? 0 : -1}
          data-active={value === tab.value ? "true" : undefined}
          onClick={() => onChange(tab.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
              : event.key === "ArrowRight" ? (index + 1) % tabs.length
                : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : null;
            if (next === null) return;
            event.preventDefault();
            onChange(tabs[next].value);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}
        >{tab.label}</button>
      ))}
    </div>
  );
}
