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
    chartRef.current?.setOption(option, true);
    const frame = window.requestAnimationFrame(() => chartRef.current?.resize());

    return () => window.cancelAnimationFrame(frame);
  }, [option]);

  return <div aria-label={ariaLabel} className={cn("icedr-echart", className)} ref={hostRef} role="img" />;
}
