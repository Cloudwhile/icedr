"use client";

import { useEffect, useRef } from "react";
import { init, use as registerEChartsModules, type ECharts, type EChartsCoreOption } from "echarts/core";
import { LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  GraphicComponent,
  LegendComponent,
  TooltipComponent,
  type GridComponentOption,
  type GraphicComponentOption,
  type LegendComponentOption,
  type TooltipComponentOption,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { cn } from "./cn";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

registerEChartsModules([
  CanvasRenderer,
  GridComponent,
  GraphicComponent,
  LegendComponent,
  LineChart,
  PieChart,
  TooltipComponent,
]);

export type EChartOption = EChartsCoreOption &
  GridComponentOption &
  GraphicComponentOption &
  LegendComponentOption &
  TooltipComponentOption;

export type EChartProps = {
  ariaLabel?: string;
  className?: string;
  option: EChartOption;
};

export function EChart({ ariaLabel, className, option }: EChartProps) {
  const reduce = usePrefersReducedMotion();
  const chartRef = useRef<ECharts | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = init(host, null, { renderer: "canvas" });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const tooltipMotion = { transitionDuration: reduce ? 0 : 0.12 };
    chartRef.current?.setOption({
      ...option,
      animation: reduce ? false : option.animation ?? true,
      animationDuration: reduce ? 0 : Math.min(typeof option.animationDuration === "number" ? option.animationDuration : 220, 220),
      animationDurationUpdate: reduce ? 0 : 180,
      stateAnimation: { ...option.stateAnimation, delay: 0, duration: reduce ? 0 : 180 },
      tooltip: Array.isArray(option.tooltip)
        ? option.tooltip.map(tooltip => ({ ...tooltip, ...tooltipMotion }))
        : { ...option.tooltip, ...tooltipMotion },
    }, true);
    if (reduce) {
      const renderer = chartRef.current?.getZr();
      renderer?.storage.getDisplayList().forEach(element => element.stopAnimation(undefined, true));
      renderer?.animation.clear();
    }
    const frame = window.requestAnimationFrame(() => chartRef.current?.resize());

    return () => window.cancelAnimationFrame(frame);
  }, [option, reduce]);

  return <div aria-label={ariaLabel} className={cn("icedr-echart", className)} ref={hostRef} role="img" />;
}
