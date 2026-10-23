import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EChart } from "./e-chart";

const chart = vi.hoisted(() => ({
  dispose: vi.fn(), resize: vi.fn(), setOption: vi.fn(),
  getZr: () => ({ storage: { getDisplayList: () => [] }, animation: { clear: vi.fn() } }),
}));
vi.mock("echarts/core", () => ({ init: () => chart, use: vi.fn() }));
vi.mock("echarts/charts", () => ({ LineChart: {}, PieChart: {} }));
vi.mock("echarts/components", () => ({ GridComponent: {}, GraphicComponent: {}, LegendComponent: {}, TooltipComponent: {} }));
vi.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("stops canvas and tooltip animations when the system preference changes without losing chart data", () => {
  const events = new EventTarget();
  const media = {
    matches: false,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect; });
  const series = [{ data: [2, 5, 3], type: "line" }];
  const { unmount } = render(<EChart option={{ animationDuration: 1000, series, tooltip: { trigger: "axis" } }} />);
  expect(chart.setOption.mock.lastCall?.[0]).toMatchObject({ animation: true, animationDuration: 220, series });
  act(() => {
    media.matches = true;
    events.dispatchEvent(new Event("change"));
  });
  expect(chart.setOption.mock.lastCall?.[0]).toMatchObject({
    animation: false,
    animationDuration: 0,
    animationDurationUpdate: 0,
    stateAnimation: { duration: 0 },
    series,
    tooltip: { transitionDuration: 0, trigger: "axis" },
  });
  act(() => {
    media.matches = false;
    events.dispatchEvent(new Event("change"));
  });
  expect(chart.setOption.mock.lastCall?.[0]).toMatchObject({ animation: true, series });
  unmount();
  expect(chart.dispose).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalledOnce();
});
