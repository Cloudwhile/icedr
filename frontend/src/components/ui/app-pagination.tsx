"use client";

import { useMemo, type CSSProperties } from "react";
import type { Palette } from "@/features/file/model";
import { AppSelect } from "./app-select";
import { LocalIcon } from "./app-icon";
import { cn } from "./cn";
import { ToolButton } from "./tool-button";

export type AppPaginationLabels = {
  next: string;
  page: string;
  pageSize: string;
  pageStatus: string;
  previous: string;
  range: string;
};

export type AppPaginationProps = {
  className?: string;
  disabled?: boolean;
  labels: AppPaginationLabels;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  page: number;
  pageSize: number;
  pageSizeOptions: number[];
  palette: Palette;
  totalItems: number;
};

export function AppPagination({
  className,
  disabled,
  labels,
  onPageChange,
  onPageSizeChange,
  page,
  pageSize,
  pageSizeOptions,
  palette,
  totalItems,
}: AppPaginationProps) {
  const normalizedPageSize = Math.max(1, Math.trunc(pageSize) || 1);
  const totalPages = Math.max(1, Math.ceil(Math.max(totalItems, 0) / normalizedPageSize));
  const safePage = Math.min(Math.max(Math.trunc(page) || 1, 1), totalPages);
  const pageOptions = useMemo(
    () => Array.from({ length: totalPages }, (_, index) => {
      const value = String(index + 1);
      return { label: value, value };
    }),
    [totalPages],
  );
  const pageSizeSelectOptions = useMemo(
    () => Array.from(new Set([...pageSizeOptions, normalizedPageSize]))
      .filter((size) => Number.isFinite(size) && size > 0)
      .sort((left, right) => left - right)
      .map((size) => {
        const value = String(size);
        return { label: value, value };
      }),
    [normalizedPageSize, pageSizeOptions],
  );
  const style = {
    "--app-pagination-border": palette.hairline,
    "--app-pagination-color": palette.ink,
    "--app-pagination-muted": palette.subtle,
    "--app-pagination-separator": palette.hairlineStrong,
  } as CSSProperties;

  return (
    <nav aria-label={labels.page} className={cn("icedr-app-pagination", className)} style={style}>
      <span className="icedr-app-pagination-range">{labels.range}</span>
      <div className="icedr-app-pagination-controls">
        <ToolButton disabled={disabled || safePage <= 1} label={labels.previous} palette={palette} size="sm" visual="surface" onClick={() => onPageChange(safePage - 1)}>
          <LocalIcon name="arrow_left" size={15} />
        </ToolButton>
        <div className="icedr-app-pagination-page">
          <AppSelect
            aria-label={labels.page}
            disabled={disabled || totalPages <= 1}
            options={pageOptions}
            palette={palette}
            value={String(safePage)}
            onChange={(event) => onPageChange(Number(event.target.value))}
          />
          <span>{labels.pageStatus}</span>
        </div>
        <ToolButton disabled={disabled || safePage >= totalPages} label={labels.next} palette={palette} size="sm" visual="surface" onClick={() => onPageChange(safePage + 1)}>
          <LocalIcon name="arrow_right" size={15} />
        </ToolButton>
        <span className="icedr-app-pagination-separator" aria-hidden="true" />
        <label className="icedr-app-pagination-size">
          <span>{labels.pageSize}</span>
          <AppSelect
            aria-label={labels.pageSize}
            disabled={disabled}
            options={pageSizeSelectOptions}
            palette={palette}
            value={String(normalizedPageSize)}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          />
        </label>
      </div>
    </nav>
  );
}
