import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui";
import {
  NoteSortMenu,
} from "./SidebarControls";

afterEach(() => {
  document.body.replaceChildren();
});

describe("NoteSortMenu", () => {
  it("offers newest and oldest ordering and reports the selected option", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <TooltipProvider>
          <NoteSortMenu sortOrder="newest" onChange={onChange} />
        </TooltipProvider>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Sort notes: Newest first"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.tabIndex).toBe(0);

    act(() => {
      trigger?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });

    const options = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    );
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      "Newest first",
      "Oldest first",
    ]);
    expect(options[0]?.getAttribute("aria-checked")).toBe("true");

    act(() => {
      options[1]?.click();
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("oldest");

    act(() => root.unmount());
  });

  it("does not prevent Radix focus restoration on the sort trigger", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <TooltipProvider>
          <NoteSortMenu sortOrder="newest" onChange={onChange} />
        </TooltipProvider>,
      );
    });

    const source = container.innerHTML;
    expect(source).not.toContain("onCloseAutoFocus");

    act(() => root.unmount());
  });
});
