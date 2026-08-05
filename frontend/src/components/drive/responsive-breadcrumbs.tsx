"use client";

import { AppMenu, type AppMenuItem } from "@/components/ui/app-menu";
import { LocalIcon } from "@/components/ui/app-icon";
import type { Palette } from "@/features/file/model";

export type DriveBreadcrumbItem = {
  id: string;
  name: string;
};

export type ResponsiveBreadcrumbsProps = {
  ancestorMenuLabel: string;
  ariaLabel: string;
  currentAnnouncement: string;
  items: DriveBreadcrumbItem[];
  onNavigateFolder: (id: string) => void;
  onNavigateRoot: () => void;
  palette: Palette;
  rootLabel: string;
};

const buttonTypeAttr: { type?: "button" } = {
  type: "button",
};

export function ResponsiveBreadcrumbs({
  ancestorMenuLabel,
  ariaLabel,
  currentAnnouncement,
  items,
  onNavigateFolder,
  onNavigateRoot,
  palette,
  rootLabel,
}: ResponsiveBreadcrumbsProps) {
  const isRootCurrent = items.length === 0;
  const currentItem = items.at(-1);
  const ancestorItems = items.slice(0, -1);
  const ancestorMenuItems: AppMenuItem[] = ancestorItems.map((item) => ({
    icon: <LocalIcon name="folder" size={15} />,
    label: item.name,
    onClick: () => onNavigateFolder(item.id),
    value: `breadcrumb-${item.id}`,
  }));

  return (
    <>
      <nav className="drive-address-bar drive-address-bar-full" aria-label={ariaLabel}>
        <RootSegment current={isRootCurrent} label={rootLabel} onNavigate={onNavigateRoot} />
        {items.map((item, index) => (
          <BreadcrumbSegment
            current={index === items.length - 1}
            item={item}
            key={item.id}
            onNavigate={onNavigateFolder}
            showCurrentIndicator={index === items.length - 1}
          />
        ))}
      </nav>

      <nav className="drive-address-bar drive-address-bar-compact" aria-label={ariaLabel}>
        <RootSegment current={isRootCurrent} label={rootLabel} onNavigate={onNavigateRoot} />
        {ancestorMenuItems.length > 0 ? (
          <span className="drive-address-segment-wrap drive-address-ancestor-wrap">
            <BreadcrumbSeparator />
            <AppMenu ariaLabel={ancestorMenuLabel} items={ancestorMenuItems} palette={palette}>
              <button
                {...buttonTypeAttr}
                aria-label={ancestorMenuLabel}
                className="drive-address-segment drive-address-ancestor-trigger"
              >
                <LocalIcon name="menu7" size={17} />
              </button>
            </AppMenu>
          </span>
        ) : null}
        {currentItem ? (
          <BreadcrumbSegment current item={currentItem} onNavigate={onNavigateFolder} />
        ) : null}
      </nav>

      <span aria-atomic="true" aria-live="polite" className="icedr-sr-only">
        {currentAnnouncement}
      </span>
    </>
  );
}

function RootSegment({ current, label, onNavigate }: {
  current: boolean;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <button
      {...buttonTypeAttr}
      aria-current={current ? "page" : undefined}
      className="drive-address-segment drive-address-root icedr-truncate"
      data-current={current ? "true" : undefined}
      onClick={onNavigate}
    >
      <span className="icedr-truncate">{label}</span>
    </button>
  );
}

function BreadcrumbSegment({
  current,
  item,
  onNavigate,
  showCurrentIndicator = false,
}: {
  current: boolean;
  item: DriveBreadcrumbItem;
  onNavigate: (id: string) => void;
  showCurrentIndicator?: boolean;
}) {
  return (
    <span className="drive-address-segment-wrap">
      <BreadcrumbSeparator />
      <button
        {...buttonTypeAttr}
        aria-current={current ? "page" : undefined}
        className="drive-address-segment icedr-truncate"
        data-current={current ? "true" : undefined}
        onClick={() => onNavigate(item.id)}
      >
        <span className="icedr-truncate">{item.name}</span>
        {showCurrentIndicator ? <LocalIcon name="arrow_down" size={12} /> : null}
      </button>
    </span>
  );
}

function BreadcrumbSeparator() {
  return (
    <span aria-hidden="true" className="drive-address-separator">
      <LocalIcon name="arrow_right" size={13} />
    </span>
  );
}
