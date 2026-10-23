"use client";

import { useState } from "react";
import { AppInput } from "@/components/ui/app-input";
import type { Palette } from "@/features/file/model";

export function OAuthDomainsInput({
  disabled,
  invalid,
  onChange,
  palette,
  placeholder,
  value,
}: {
  disabled?: boolean;
  invalid?: boolean;
  onChange: (domains: string[]) => void;
  palette: Palette;
  placeholder: string;
  value: string[];
}) {
  const normalized = value.join("\n");
  const [edit, setEdit] = useState({ normalized, raw: value.join(", ") });
  if (edit.normalized !== normalized) {
    setEdit({ normalized, raw: value.join(", ") });
  }
  return (
    <AppInput
      disabled={disabled}
      invalid={invalid}
      palette={palette}
      placeholder={placeholder}
      value={edit.raw}
      onChange={(event) => {
        const raw = event.target.value;
        const domains = Array.from(
          new Set(
            raw
              .split(/[\s,;]+/)
              .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
              .filter(Boolean),
          ),
        );
        setEdit({ normalized: domains.join("\n"), raw });
        onChange(domains);
      }}
    />
  );
}
