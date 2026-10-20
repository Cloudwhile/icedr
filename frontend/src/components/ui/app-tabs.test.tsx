import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { AppTabs } from "./app-tabs";

it("moves the selected tab and keyboard entry together with arrows, Home and End", () => {
  function Tabs() {
    const [value, setValue] = useState("details");
    return <AppTabs id="file" label="File" value={value} onChange={setValue} tabs={[
      {value: "details", label: "Details"}, {value: "share", label: "Share"}, {value: "versions", label: "Versions"},
    ]} />;
  }
  render(<Tabs />);
  const tabs = screen.getAllByRole("tab");
  tabs[0].focus();
  fireEvent.keyDown(tabs[0], {key: "ArrowRight"});
  expect(tabs[1]).toHaveFocus();
  expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  expect(tabs.filter(tab => tab.tabIndex === 0)).toEqual([tabs[1]]);
  fireEvent.keyDown(tabs[1], {key: "End"});
  expect(tabs[2]).toHaveFocus();
  fireEvent.keyDown(tabs[2], {key: "ArrowRight"});
  expect(tabs[0]).toHaveFocus();
  fireEvent.keyDown(tabs[0], {key: "ArrowLeft"});
  expect(tabs[2]).toHaveFocus();
  fireEvent.keyDown(tabs[2], {key: "Home"});
  expect(tabs[0]).toHaveFocus();
});
