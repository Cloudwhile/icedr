"use client";

import type { CSSProperties } from "react";
import { MotionList } from "@/components/ui/motion";
import type { DriveModule, Palette } from "@/features/file/model";
import { SkeletonBlock } from "./loading-skeleton-primitives";

const settingRows = Array.from({
  length: 5,
}, (_, index) => index);

export function WorkspaceSkeleton({
  activeModule,
  palette,
}: {
  activeModule: DriveModule | "settings";
  palette: Palette;
  viewMode: "list" | "grid";
}) {
  if (activeModule !== "settings") return null;

  return (
    <MotionList
      key={activeModule}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        maxWidth: "920px",
      }}
    >
      {settingRows.map((item) => (
        <div
          key={item}
          data-skeleton-row
          style={{
            background: palette.surface1,
            borderColor: palette.hairline,
            borderRadius: "8px",
            borderWidth: "1px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            padding: "16px",
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              gap: "12px",
            }}
          >
            <SkeletonBlock
              palette={palette}
              style={{
                borderRadius: "8px",
                height: "28px",
                width: "28px",
              }}
            />
            <SkeletonBlock
              palette={palette}
              className="icedr-r-width"
              style={{
                "--r-width-base": "60%",
                "--r-width-md": "240px",
                height: "14px",
              } as CSSProperties}
            />
          </div>
          <div
            className="icedr-r-grid-template-columns"
            style={{
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "repeat(3, minmax(0, 1fr))",
              display: "grid",
              gap: "12px",
            } as CSSProperties}
          >
            <SkeletonBlock
              palette={palette}
              style={{
                height: "38px",
              }}
            />
            <SkeletonBlock
              palette={palette}
              style={{
                height: "38px",
              }}
            />
            <SkeletonBlock
              palette={palette}
              style={{
                height: "38px",
              }}
            />
          </div>
        </div>
      ))}
    </MotionList>
  );
}
