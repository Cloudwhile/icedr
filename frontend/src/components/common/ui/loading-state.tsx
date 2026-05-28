"use client";

import { tailChase } from "ldrs";
import { useMotionReveal } from "@/components/ui/motion";
import type { Palette } from "@/features/file/model";
import { DetailsPanelSkeleton } from "./drive-loading-state";
import { SkeletonBlock } from "./loading-skeleton-primitives";
if (typeof window !== "undefined") {
  tailChase.register();
}
const gridCards = Array.from({
  length: 8
}, (_, index) => index);
const compactRows = Array.from({
  length: 5
}, (_, index) => index);
const metrics = Array.from({
  length: 3
}, (_, index) => index);
const sidebarRows = Array.from({
  length: 8
}, (_, index) => index);
const fileRows = Array.from({
  length: 9
}, (_, index) => index);
const fileRowWidths = ["72%", "54%", "64%", "46%", "78%", "58%", "68%", "50%", "62%"];
const gridCardWidths = ["68%", "52%", "74%", "58%", "62%", "70%", "48%", "64%"];
export type AppLoadingStage = "progress" | "skeleton";
export { SkeletonBlock };
export function LoadingSpinner({
  palette,
  size = 18
}: {
  palette: Palette;
  size?: number;
}) {
  const loaderSize = Math.max(16, size);
  const frameSize = Math.max(20, loaderSize + 6);
  return <div aria-hidden="true" style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${frameSize}px`,
    height: `${frameSize}px`,
    background: "transparent",
    color: palette.primaryHover
  }}>
      <l-tail-chase size={`${loaderSize}`} speed="1.75" color={"currentColor"} />
    </div>;
}
export function LoadingCurtain({
  label = "Loading",
  palette
}: {
  label?: string;
  palette: Palette;
}) {
  const revealRef = useMotionReveal<HTMLDivElement>("menu", []);
  return <div ref={revealRef} role="status" aria-live="polite" aria-label="Loading" className="icedr-r-right icedr-r-top icedr-r-transform" style={{
    alignItems: "center",
    display: "flex",
    position: "fixed",
    "--r-top-base": "68px",
    "--r-top-md": "70px",
    "--r-right-base": "50%",
    "--r-right-md": "20px",
    "--r-transform-base": "translateX(50%)",
    "--r-transform-md": "none",
    zIndex: "60",
    gap: "12px",
    maxWidth: "calc(100vw - 24px)",
    paddingInline: "12px",
    paddingBlock: "8px",
    borderRadius: "8px",
    background: palette.surface1,
    color: palette.ink,
    borderWidth: "1px",
    borderColor: palette.hairlineStrong,
    boxShadow: "0 16px 44px rgba(0, 0, 0, 0.28)",
    pointerEvents: "none"
  } as React.CSSProperties}>
      <LoadingSpinner palette={palette} size={16} />
      <span style={{
      color: palette.muted,
      fontSize: "12px",
      fontWeight: "600",
      whiteSpace: "nowrap"
    }}>
        {label}
      </span>
    </div>;
}
export function AppLoading({
  label = "Loading workspace",
  palette,
  stage,
  viewMode = "list"
}: {
  label?: string;
  palette: Palette;
  stage: AppLoadingStage;
  viewMode?: "list" | "grid";
}) {
  if (stage === "progress") {
    return <div style={{
      position: "fixed",
      top: "0px",
      zIndex: "70",
      pointerEvents: "none"
    }}>
        <div style={{
        height: "2px",
        background: "transparent",
        overflow: "hidden"
      }}>
          <div className="icedr-top-progress" style={{
          background: palette.primaryHover
        }} />
        </div>
        <LoadingCurtain label={label} palette={palette} />
      </div>;
  }
  return <div aria-label={label} role="status" style={{
    position: "fixed",
    inset: "0px",
    zIndex: "70",
    background: palette.canvas,
    color: palette.ink,
    pointerEvents: "none"
  }}>
      <div style={{
      display: "flex",
      flexDirection: "column",
      minHeight: "100vh",
      gap: "0px"
    }}>
        <TopbarSkeleton palette={palette} />
        <div className="icedr-r-grid-template-columns" style={{
        display: "grid",
        "--r-grid-template-columns-base": "1fr",
        "--r-grid-template-columns-lg": "248px minmax(0, 1fr) 316px",
        flex: "1 1 auto",
        minHeight: "0px"
      } as React.CSSProperties}>
          <SidebarSkeleton palette={palette} />
          <MainContentSkeleton palette={palette} viewMode={viewMode} />
          <DetailsPanelSkeleton palette={palette} />
        </div>
      </div>
      <div style={{
      position: "fixed",
      top: "0px",
      height: "2px",
      overflow: "hidden"
    }}>
        <div className="icedr-top-progress" style={{
        background: palette.primaryHover
      }} />
      </div>
      <LoadingCurtain label={label} palette={palette} />
    </div>;
}
function TopbarSkeleton({
  palette
}: {
  palette: Palette;
}) {
  return <div className="icedr-r-padding-inline" style={{
    display: "flex",
    height: "56px",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    "--r-padding-inline-base": "12px",
    "--r-padding-inline-md": "20px",
    borderBottomWidth: "1px",
    borderColor: palette.hairline
  } as React.CSSProperties}>
      <div className="icedr-r-width" style={{
      alignItems: "center",
      display: "flex",
      gap: "8px",
      "--r-width-base": "auto",
      "--r-width-md": "248px",
      flexShrink: "0"
    } as React.CSSProperties}>
        <SkeletonBlock palette={palette} style={{
        width: "28px",
        height: "28px",
        borderRadius: "8px"
      }} />
        <SkeletonBlock palette={palette} className="icedr-r-display" style={{
        "--r-display-base": "none",
        "--r-display-md": "block",
        width: "72px",
        height: "14px"
      } as React.CSSProperties} />
      </div>
      <div style={{
      alignItems: "center",
      display: "flex",
      width: "100%",
      maxWidth: "680px",
      minWidth: "0px",
      height: "40px",
      gap: "8px",
      paddingInline: "12px",
      borderRadius: "8px",
      background: palette.surface1,
      borderWidth: "1px",
      borderColor: palette.hairline
    }}>
        <SkeletonBlock palette={palette} style={{
        width: "16px",
        height: "16px",
        borderRadius: "100%"
      }} />
        <SkeletonBlock palette={palette} style={{
        height: "12px",
        flex: "1 1 auto"
      }} />
        <SkeletonBlock palette={palette} style={{
        width: "24px",
        height: "24px",
        borderRadius: "6px"
      }} />
      </div>
      <div className="icedr-r-width" style={{
      alignItems: "center",
      display: "flex",
      gap: "8px",
      "--r-width-base": "auto",
      "--r-width-md": "248px",
      justifyContent: "flex-end",
      flexShrink: "0"
    } as React.CSSProperties}>
        <SkeletonBlock palette={palette} className="icedr-r-display" style={{
        "--r-display-base": "none",
        "--r-display-md": "block",
        width: "36px",
        height: "36px",
        borderRadius: "8px"
      } as React.CSSProperties} />
        <SkeletonBlock palette={palette} style={{
        width: "36px",
        height: "36px",
        borderRadius: "8px"
      }} />
        <SkeletonBlock palette={palette} style={{
        width: "32px",
        height: "32px",
        borderRadius: "100%"
      }} />
      </div>
    </div>;
}
function SidebarSkeleton({
  palette
}: {
  palette: Palette;
}) {
  return <div className="icedr-r-display" style={{
    "--r-display-base": "none",
    "--r-display-lg": "block",
    borderRightWidth: "1px",
    borderColor: palette.hairline,
    padding: "12px"
  } as React.CSSProperties}>
      <div style={{
      display: "flex",
      flexDirection: "column",
      gap: "12px"
    }}>
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px"
      }}>
          {sidebarRows.slice(0, 6).map(item => <div key={item} style={{
          alignItems: "center",
          display: "flex",
          height: "38px",
          paddingInline: "12px",
          gap: "12px"
        }}>
              <SkeletonBlock palette={palette} style={{
            width: "17px",
            height: "17px",
            borderRadius: "5px"
          }} />
              <SkeletonBlock palette={palette} style={{
            height: "11px",
            width: `${64 + item % 3 * 18}px`
          }} />
            </div>)}
        </div>
        <div style={{
        height: "1px",
        background: palette.hairline
      }} />
        <div style={{
        alignItems: "center",
        display: "flex",
        height: "38px",
        paddingInline: "12px",
        gap: "12px"
      }}>
          <SkeletonBlock palette={palette} style={{
          width: "17px",
          height: "17px",
          borderRadius: "5px"
        }} />
          <SkeletonBlock palette={palette} style={{
          height: "11px",
          width: "78px"
        }} />
        </div>
        <div style={{
        height: "1px",
        background: palette.hairline
      }} />
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        paddingInline: "12px",
        paddingBlock: "4px"
      }}>
          <div style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between"
        }}>
            <SkeletonBlock palette={palette} style={{
            height: "12px",
            width: "86px"
          }} />
            <SkeletonBlock palette={palette} style={{
            height: "15px",
            width: "15px",
            borderRadius: "5px"
          }} />
          </div>
          <SkeletonBlock palette={palette} style={{
          height: "6px",
          width: "100%",
          borderRadius: "100%"
        }} />
          <SkeletonBlock palette={palette} style={{
          height: "10px",
          width: "116px"
        }} />
        </div>
      </div>
    </div>;
}
function MainContentSkeleton({
  palette,
  viewMode
}: {
  palette: Palette;
  viewMode: "list" | "grid";
}) {
  return <div style={{
    display: "flex",
    flexDirection: "column",
    minWidth: "0px",
    minHeight: "0px",
    gap: "0px"
  }}>
      <div className="icedr-r-padding-inline" style={{
      display: "flex",
      height: "65px",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      "--r-padding-inline-base": "12px",
      "--r-padding-inline-md": "24px",
      paddingBlock: "12px",
      background: palette.surface1,
      borderBottomWidth: "1px",
      borderColor: palette.hairline
    } as React.CSSProperties}>
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        minWidth: "0px"
      }}>
          <div style={{
          alignItems: "center",
          display: "flex",
          gap: "8px"
        }}>
            <SkeletonBlock palette={palette} style={{
            height: "18px",
            width: "96px"
          }} />
            <SkeletonBlock palette={palette} style={{
            height: "18px",
            width: "18px",
            borderRadius: "5px"
          }} />
            <SkeletonBlock palette={palette} style={{
            height: "20px",
            width: "38px",
            borderRadius: "100%"
          }} />
          </div>
          <SkeletonBlock palette={palette} className="icedr-r-width" style={{
          height: "10px",
          "--r-width-base": "180px",
          "--r-width-md": "260px"
        } as React.CSSProperties} />
        </div>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "8px"
      }}>
          <SkeletonBlock palette={palette} style={{
          width: "40px",
          height: "40px",
          borderRadius: "8px"
        }} />
          <SkeletonBlock palette={palette} className="icedr-r-display" style={{
          "--r-display-base": "none",
          "--r-display-sm": "block",
          width: "40px",
          height: "40px",
          borderRadius: "8px"
        } as React.CSSProperties} />
          <SkeletonBlock palette={palette} className="icedr-r-display" style={{
          "--r-display-base": "none",
          "--r-display-md": "block",
          width: "40px",
          height: "40px",
          borderRadius: "8px"
        } as React.CSSProperties} />
        </div>
      </div>
      <div className="icedr-r-padding-inline" style={{
      display: "flex",
      flexDirection: "column",
      "--r-padding-inline-base": "12px",
      "--r-padding-inline-md": "24px",
      paddingBlock: "16px",
      gap: "16px",
      flex: "1 1 auto",
      minHeight: "0px"
    } as React.CSSProperties}>
        <div className="icedr-r-grid-template-columns" style={{
        display: "grid",
        "--r-grid-template-columns-base": "1fr",
        "--r-grid-template-columns-md": "repeat(3, minmax(0, 1fr))",
        gap: "12px"
      } as React.CSSProperties}>
          {metrics.map(item => <div key={item} style={{
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
              width: `${70 - item * 12}%`
            }} />
                <SkeletonBlock palette={palette} style={{
              height: "10px",
              width: `${44 + item * 8}%`
            }} />
              </div>
            </div>)}
        </div>
        {viewMode === "grid" ? <AppGridSkeleton palette={palette} /> : <AppFileListSkeleton palette={palette} />}
      </div>
    </div>;
}
function AppFileListSkeleton({
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
      <div className="icedr-r-grid-template-columns" style={{
      display: "grid",
      "--r-grid-template-columns-base": "40px minmax(160px, 1fr) 80px",
      "--r-grid-template-columns-md": "40px minmax(240px, 1fr) 110px 120px 140px 100px",
      gap: "16px",
      alignItems: "center",
      height: "44px",
      paddingInline: "12px",
      background: palette.surface2
    } as React.CSSProperties}>
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
        <SkeletonBlock palette={palette} className="icedr-r-display" style={{
        "--r-display-base": "none",
        "--r-display-md": "block",
        height: "10px"
      } as React.CSSProperties} />
        <SkeletonBlock palette={palette} className="icedr-r-display" style={{
        "--r-display-base": "none",
        "--r-display-md": "block",
        height: "10px"
      } as React.CSSProperties} />
        <SkeletonBlock palette={palette} className="icedr-r-display" style={{
        "--r-display-base": "none",
        "--r-display-md": "block",
        height: "10px"
      } as React.CSSProperties} />
      </div>
      {fileRows.map(item => <div key={item} className="icedr-r-grid-template-columns" style={{
      display: "grid",
      "--r-grid-template-columns-base": "40px minmax(160px, 1fr) 80px",
      "--r-grid-template-columns-md": "40px minmax(240px, 1fr) 110px 120px 140px 100px",
      gap: "16px",
      alignItems: "center",
      height: "54px",
      paddingInline: "12px",
      borderTopWidth: "1px",
      borderColor: palette.hairline
    } as React.CSSProperties}>
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
          width: fileRowWidths[item]
        }} />
          </div>
          <SkeletonBlock palette={palette} style={{
        height: "10px",
        width: `${52 + item % 3 * 10}px`
      }} />
          <SkeletonBlock palette={palette} className="icedr-r-display" style={{
        "--r-display-base": "none",
        "--r-display-md": "block",
        height: "10px"
      } as React.CSSProperties} />
          <SkeletonBlock palette={palette} className="icedr-r-display" style={{
        "--r-display-base": "none",
        "--r-display-md": "block",
        height: "10px",
        width: `${72 + item % 4 * 12}px`
      } as React.CSSProperties} />
          <SkeletonBlock palette={palette} className="icedr-r-display" style={{
        "--r-display-base": "none",
        "--r-display-md": "block",
        height: "10px"
      } as React.CSSProperties} />
        </div>)}
    </div>;
}
function AppGridSkeleton({
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
      {gridCards.map(item => <div key={item} style={{
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
          width: gridCardWidths[item]
        }} />
          </div>
          <div style={{
        display: "flex",
        height: "132px",
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
          width: `${72 + item % 3 * 12}px`
        }} />
            <SkeletonBlock palette={palette} style={{
          height: "22px",
          width: "28px"
        }} />
          </div>
        </div>)}
    </div>;
}
export { DetailsPanelSkeleton, WorkspaceSkeleton } from "./drive-loading-state";
export function ShareCreationSkeleton({
  palette
}: {
  palette: Palette;
}) {
  return <div style={{
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "16px"
  }}>
      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "12px"
    }}>
        <LoadingSpinner palette={palette} size={18} />
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        flex: "1 1 auto"
      }}>
          <SkeletonBlock palette={palette} style={{
          height: "14px",
          width: "42%"
        }} />
          <SkeletonBlock palette={palette} style={{
          height: "10px",
          width: "64%"
        }} />
        </div>
      </div>
      <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: "8px"
    }}>
        {metrics.map(item => <div key={item} style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px",
        borderRadius: "8px",
        background: palette.surface1,
        borderWidth: "1px",
        borderColor: palette.hairline
      }}>
            <SkeletonBlock palette={palette} style={{
          height: "10px",
          width: "50%"
        }} />
            <SkeletonBlock palette={palette} style={{
          height: "16px",
          width: "70%"
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
        {compactRows.map(item => <div key={item} style={{
        display: "flex",
        gap: "12px",
        alignItems: "center",
        minHeight: "54px",
        paddingInline: "16px",
        borderBottomWidth: item === compactRows.length - 1 ? "0" : "1px",
        borderColor: palette.hairline
      }}>
            <SkeletonBlock palette={palette} style={{
          width: "26px",
          height: "26px",
          borderRadius: "8px"
        }} />
            <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          flex: "1 1 auto"
        }}>
              <SkeletonBlock palette={palette} style={{
            height: "11px",
            width: "70%"
          }} />
              <SkeletonBlock palette={palette} style={{
            height: "9px",
            width: "38%"
          }} />
            </div>
          </div>)}
      </div>
    </div>;
}
export function ExternalSharePageSkeleton({
  palette
}: {
  palette: Palette;
}) {
  return <div style={{
    display: "flex",
    minHeight: "100vh",
    background: palette.canvas,
    alignItems: "center",
    justifyContent: "center",
    paddingInline: "12px",
    paddingBlock: "32px"
  }}>
      <div style={{
      display: "flex",
      flexDirection: "column",
      width: "100%",
      maxWidth: "680px",
      gap: "16px",
      alignItems: "stretch"
    }}>
        <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "12px",
        textAlign: "center"
      }}>
          <div style={{
          display: "flex",
          width: "42px",
          height: "42px",
          borderRadius: "10px",
          background: palette.surface2,
          borderWidth: "1px",
          borderColor: palette.hairline,
          alignItems: "center",
          justifyContent: "center"
        }}>
            <SkeletonBlock palette={palette} style={{
            width: "24px",
            height: "24px",
            borderRadius: "8px"
          }} />
          </div>
          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          alignItems: "center"
        }}>
            <SkeletonBlock palette={palette} style={{
            height: "16px",
            width: "86px"
          }} />
            <div style={{
            alignItems: "center",
            display: "flex",
            gap: "8px"
          }}>
              <LoadingSpinner palette={palette} size={16} />
              <span style={{
              color: palette.muted,
              fontSize: "12px",
              fontWeight: "600"
            }}>
                Opening shared link...
              </span>
            </div>
          </div>
        </div>

        <div className="icedr-r-padding" style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        "--r-padding-base": "16px",
        "--r-padding-md": "20px",
        borderRadius: "8px",
        background: palette.surface1,
        borderWidth: "1px",
        borderColor: palette.hairline
      } as React.CSSProperties}>
          <div style={{
          display: "flex",
          gap: "16px",
          alignItems: "flex-start"
        }}>
            <SkeletonBlock palette={palette} style={{
            width: "44px",
            height: "44px",
            borderRadius: "8px"
          }} />
            <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            flex: "1 1 auto",
            minWidth: "0px"
          }}>
              <SkeletonBlock palette={palette} style={{
              height: "18px",
              width: "56%"
            }} />
              <SkeletonBlock palette={palette} style={{
              height: "12px",
              width: "74%"
            }} />
            </div>
          </div>
          <div className="icedr-r-grid-template-columns" style={{
          display: "grid",
          "--r-grid-template-columns-base": "1fr",
          "--r-grid-template-columns-sm": "repeat(3, minmax(0, 1fr))",
          gap: "8px"
        } as React.CSSProperties}>
            {metrics.map(item => <div key={item} style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "12px",
            borderRadius: "8px",
            background: palette.surface2,
            borderWidth: "1px",
            borderColor: palette.hairline
          }}>
                <SkeletonBlock palette={palette} style={{
              height: "10px",
              width: `${46 + item * 10}%`
            }} />
                <SkeletonBlock palette={palette} style={{
              height: "16px",
              width: `${68 - item * 8}%`
            }} />
              </div>)}
          </div>
          <div style={{
          display: "flex",
          flexDirection: "column",
          borderRadius: "8px",
          background: palette.surface2,
          borderWidth: "1px",
          borderColor: palette.hairline,
          overflow: "hidden"
        }}>
            {compactRows.slice(0, 3).map(item => <div key={item} style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            paddingInline: "16px",
            minHeight: "58px",
            borderBottomWidth: item === 2 ? "0" : "1px",
            borderColor: palette.hairline
          }}>
                <SkeletonBlock palette={palette} style={{
              width: "28px",
              height: "28px",
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
                width: fileRowWidths[item]
              }} />
                  <SkeletonBlock palette={palette} style={{
                height: "9px",
                width: `${34 + item * 10}%`
              }} />
                </div>
                <SkeletonBlock palette={palette} style={{
              height: "10px",
              width: "64px"
            }} />
              </div>)}
          </div>
        </div>
      </div>
    </div>;
}


