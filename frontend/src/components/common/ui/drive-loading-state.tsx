"use client";

import { MotionList } from "@/components/ui/motion";
import type { DriveModule, Palette } from "@/features/file/model";
import { SkeletonBlock } from "./loading-skeleton-primitives";

const tableRows = Array.from({
  length: 8,
}, (_, index) => index);
const gridCards = Array.from({
  length: 8,
}, (_, index) => index);
const compactRows = Array.from({
  length: 5,
}, (_, index) => index);
const metrics = Array.from({
  length: 3,
}, (_, index) => index);

export function WorkspaceSkeleton({
  activeModule,
  palette,
  viewMode
}: {
  activeModule: DriveModule | "settings";
  palette: Palette;
  viewMode: "list" | "grid";
}) {
  if (activeModule === "drive") {
    return <MotionList key={`${activeModule}-${viewMode}`} style={{
      display: "flex",
      flexDirection: "column",
      gap: "16px"
    }}>
        <div className="icedr-r-grid-template-columns" style={{
        display: "grid",
        "--r-grid-template-columns-base": "1fr",
        "--r-grid-template-columns-md": "repeat(3, minmax(0, 1fr))",
        gap: "12px"
      } as React.CSSProperties}>
          {metrics.map(item => <div key={item} data-skeleton-row style={{
          display: "flex",
          height: "76px",
          alignItems: "center",
          gap: "12px",
          padding: "16px",
          borderRadius: "8px",
          background: palette.surface1,
          borderWidth: "1px",
          borderColor: palette.hairline
        }}>
              <SkeletonBlock palette={palette} style={{
            width: "34px",
            height: "34px",
            borderRadius: "8px"
          }} />
              <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            flex: "1 1 auto",
            minWidth: "0px"
          }}>
                <SkeletonBlock palette={palette} style={{
              height: "12px",
              width: "70%"
            }} />
                <SkeletonBlock palette={palette} style={{
              height: "10px",
              width: "44%"
            }} />
              </div>
            </div>)}
        </div>

        {viewMode === "list" ? <TableSkeleton palette={palette} /> : <GridSkeleton palette={palette} />}
      </MotionList>;
  }
  if (activeModule === "settings") {
    return <MotionList key={activeModule} style={{
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      maxWidth: "920px"
    }}>
        {compactRows.map(item => <div key={item} data-skeleton-row style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        padding: "16px",
        borderRadius: "8px",
        background: palette.surface1,
        borderWidth: "1px",
        borderColor: palette.hairline
      }}>
            <div style={{
          alignItems: "center",
          display: "flex",
          gap: "12px"
        }}>
              <SkeletonBlock palette={palette} style={{
            width: "28px",
            height: "28px",
            borderRadius: "8px"
          }} />
              <SkeletonBlock palette={palette} className="icedr-r-width" style={{
            height: "14px",
            "--r-width-base": "60%",
            "--r-width-md": "240px"
          } as React.CSSProperties} />
            </div>
            <div className="icedr-r-grid-template-columns" style={{
          display: "grid",
          "--r-grid-template-columns-base": "1fr",
          "--r-grid-template-columns-md": "repeat(3, minmax(0, 1fr))",
          gap: "12px"
        } as React.CSSProperties}>
              <SkeletonBlock palette={palette} style={{
            height: "38px"
          }} />
              <SkeletonBlock palette={palette} style={{
            height: "38px"
          }} />
              <SkeletonBlock palette={palette} style={{
            height: "38px"
          }} />
            </div>
          </div>)}
      </MotionList>;
  }
  return <MotionList key={activeModule} style={{
    display: "flex",
    flexDirection: "column",
    gap: "16px"
  }}>
      <div className="icedr-r-grid-template-columns" style={{
      display: "grid",
      "--r-grid-template-columns-base": "1fr",
      "--r-grid-template-columns-md": "1.2fr repeat(3, minmax(0, 1fr))",
      gap: "12px"
    } as React.CSSProperties}>
        {metrics.concat([3]).map(item => <div key={item} data-skeleton-row style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "16px",
        borderRadius: "8px",
        background: palette.surface1,
        borderWidth: "1px",
        borderColor: palette.hairline
      }}>
            <SkeletonBlock palette={palette} style={{
          height: "12px",
          width: "46%"
        }} />
            <SkeletonBlock palette={palette} style={{
          height: "24px",
          width: "34%"
        }} />
          </div>)}
      </div>
      <div style={{
      display: "flex",
      flexDirection: "column",
      borderRadius: "8px",
      background: palette.surface1,
      borderWidth: "1px",
      borderColor: palette.hairline,
      overflow: "hidden"
    }}>
        {compactRows.map(item => <div key={item} data-skeleton-row className="icedr-r-grid-template-columns" style={{
        display: "grid",
        "--r-grid-template-columns-base": "1fr",
        "--r-grid-template-columns-md": "1.4fr repeat(4, minmax(0, 1fr))",
        gap: "16px",
        alignItems: "center",
        minHeight: "58px",
        paddingInline: "16px",
        borderBottomWidth: item === compactRows.length - 1 ? "0" : "1px",
        borderColor: palette.hairline
      } as React.CSSProperties}>
            <div style={{
          alignItems: "center",
          display: "flex",
          gap: "12px",
          minWidth: "0px"
        }}>
              <SkeletonBlock palette={palette} style={{
            width: "28px",
            height: "28px",
            borderRadius: "8px"
          }} />
              <SkeletonBlock palette={palette} style={{
            height: "12px",
            width: "70%"
          }} />
            </div>
            <SkeletonBlock palette={palette} style={{
          height: "10px"
        }} />
            <SkeletonBlock palette={palette} style={{
          height: "10px"
        }} />
            <SkeletonBlock palette={palette} style={{
          height: "10px"
        }} />
            <SkeletonBlock palette={palette} className="icedr-r-justify-self" style={{
          height: "26px",
          width: "72px",
          "--r-justify-self-md": "end"
        } as React.CSSProperties} />
          </div>)}
      </div>
    </MotionList>;
}
function TableSkeleton({
  palette
}: {
  palette: Palette;
}) {
  return <div style={{
    display: "flex",
    flexDirection: "column",
    borderRadius: "8px",
    background: palette.surface1,
    borderWidth: "1px",
    borderColor: palette.hairline,
    overflow: "hidden"
  }}>
      <div style={{
      display: "grid",
      gridTemplateColumns: "48px minmax(260px, 1fr) 150px 118px 142px 88px",
      gap: "16px",
      alignItems: "center",
      height: "40px",
      paddingInline: "12px",
      background: palette.surface2
    }}>
        <SkeletonBlock palette={palette} style={{
        width: "16px",
        height: "16px",
        borderRadius: "4px"
      }} />
        <SkeletonBlock palette={palette} style={{
        height: "10px",
        width: "64px"
      }} />
        <SkeletonBlock palette={palette} style={{
        height: "10px"
      }} />
        <SkeletonBlock palette={palette} style={{
        height: "10px"
      }} />
        <SkeletonBlock palette={palette} style={{
        height: "10px"
      }} />
        <div />
      </div>
      {tableRows.map(item => <div key={item} data-skeleton-row style={{
      display: "grid",
      gridTemplateColumns: "48px minmax(260px, 1fr) 150px 118px 142px 88px",
      gap: "16px",
      alignItems: "center",
      height: "56px",
      paddingInline: "12px",
      borderTopWidth: "1px",
      borderColor: palette.hairline
    }}>
          <SkeletonBlock palette={palette} style={{
        width: "16px",
        height: "16px",
        borderRadius: "4px"
      }} />
          <div style={{
        alignItems: "center",
        display: "flex",
        gap: "12px",
        minWidth: "0px"
      }}>
            <SkeletonBlock palette={palette} style={{
          width: "28px",
          height: "28px",
          borderRadius: "8px"
        }} />
            <SkeletonBlock palette={palette} style={{
          height: "12px",
          width: "72%"
        }} />
          </div>
          <SkeletonBlock palette={palette} style={{
        height: "10px"
      }} />
          <SkeletonBlock palette={palette} style={{
        height: "10px"
      }} />
          <SkeletonBlock palette={palette} style={{
        height: "10px"
      }} />
          <SkeletonBlock palette={palette} style={{
        height: "26px",
        width: "72px",
        justifySelf: "end"
      }} />
        </div>)}
    </div>;
}
function GridSkeleton({
  palette
}: {
  palette: Palette;
}) {
  return <div className="icedr-r-grid-template-columns" style={{
    display: "grid",
    "--r-grid-template-columns-base": "1fr",
    "--r-grid-template-columns-sm": "repeat(2, minmax(0, 1fr))",
    "--r-grid-template-columns-xl": "repeat(4, minmax(0, 1fr))",
    gap: "12px"
  } as React.CSSProperties}>
      {gridCards.map(item => <div key={item} data-skeleton-row style={{
      display: "flex",
      flexDirection: "column",
      gap: "0px",
      borderRadius: "8px",
      overflow: "hidden",
      background: palette.surface1,
      borderWidth: "1px",
      borderColor: palette.hairline
    }}>
          <div style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        height: "48px",
        paddingInline: "12px"
      }}>
            <SkeletonBlock palette={palette} style={{
          width: "24px",
          height: "24px",
          borderRadius: "8px"
        }} />
            <SkeletonBlock palette={palette} style={{
          height: "12px",
          flex: "1 1 auto"
        }} />
            <SkeletonBlock palette={palette} style={{
          width: "16px",
          height: "16px",
          borderRadius: "4px"
        }} />
          </div>
          <div style={{
        display: "flex",
        height: "128px",
        alignItems: "center",
        justifyContent: "center",
        background: palette.surface2,
        borderTopWidth: "1px",
        borderColor: palette.hairline
      }}>
            <SkeletonBlock palette={palette} style={{
          width: "52px",
          height: "52px",
          borderRadius: "10px"
        }} />
          </div>
          <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "44px",
        paddingInline: "12px"
      }}>
            <SkeletonBlock palette={palette} style={{
          height: "10px",
          width: "82px"
        }} />
            <SkeletonBlock palette={palette} style={{
          height: "22px",
          width: "28px"
        }} />
          </div>
        </div>)}
    </div>;
}
export function DetailsPanelSkeleton({
  palette
}: {
  palette: Palette;
}) {
  return <MotionList className="drive-details-panel">
      <div style={{
      display: "flex",
      flexDirection: "column",
      gap: "20px",
      padding: "16px"
    }}>
        <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }}>
          <SkeletonBlock palette={palette} style={{
          height: "16px",
          width: "92px"
        }} />
          <SkeletonBlock palette={palette} style={{
          height: "34px",
          width: "34px",
          borderRadius: "8px"
        }} />
        </div>
        <div data-skeleton-row style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "156px",
        borderRadius: "8px",
        background: palette.surface1,
        borderWidth: "1px",
        borderColor: palette.hairline
      }}>
          <SkeletonBlock palette={palette} style={{
          width: "58px",
          height: "58px",
          borderRadius: "12px"
        }} />
        </div>
        <div data-skeleton-row style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px"
      }}>
          <SkeletonBlock palette={palette} style={{
          height: "16px",
          width: "76%"
        }} />
          <SkeletonBlock palette={palette} style={{
          height: "11px",
          width: "42%"
        }} />
        </div>
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px"
      }}>
          {compactRows.map(item => <div key={item} data-skeleton-row style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "16px"
        }}>
              <SkeletonBlock palette={palette} style={{
            height: "10px",
            width: "34%"
          }} />
              <SkeletonBlock palette={palette} style={{
            height: "10px",
            width: "46%"
          }} />
            </div>)}
        </div>
      </div>
    </MotionList>;
}

