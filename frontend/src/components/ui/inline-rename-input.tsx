"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { Palette } from "@/features/file/model";

export type InlineRenameInputProps = {
  ariaLabel: string;
  onCancel: () => void;
  onCommit: (value: string) => boolean | Promise<boolean>;
  palette: Palette;
  selectBaseName?: boolean;
  value: string;
};

export function InlineRenameInput({
  ariaLabel,
  onCancel,
  onCommit,
  palette,
  selectBaseName = false,
  value,
}: InlineRenameInputProps) {
  const [currentValue, setCurrentValue] = useState(value);
  const [committing, setCommitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const frame = window.requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      const selectionEnd = selectBaseName ? getBaseNameSelectionEnd(value) : value.length;
      input.setSelectionRange(0, selectionEnd);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectBaseName, value]);

  const commit = async () => {
    if (finishedRef.current || committing) return;
    finishedRef.current = true;
    setCommitting(true);

    const completed = await onCommit(currentValue);
    if (completed) return;

    finishedRef.current = false;
    setCommitting(false);
    inputRef.current?.focus({ preventScroll: true });
  };

  const cancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  return (
    <input
      aria-label={ariaLabel}
      className="icedr-inline-rename-input"
      disabled={committing}
      onBlur={() => void commit()}
      onChange={(event) => setCurrentValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      ref={inputRef}
      style={{
        "--rename-bg": palette.surface1,
        "--rename-border": palette.primary,
        "--rename-color": palette.ink,
        "--rename-focus": palette.focusRing,
        "--rename-selection": palette.selected,
      } as CSSProperties}
      type="text"
      value={currentValue}
    />
  );
}

function getBaseNameSelectionEnd(name: string) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return name.length;
  return dotIndex;
}
