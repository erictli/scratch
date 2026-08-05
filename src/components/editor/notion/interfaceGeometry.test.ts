import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getInterfaceZoom,
  viewportValueToInterface,
} from "./interfaceGeometry";

describe("interface geometry under CSS zoom", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("zoom");
  });

  it("converts viewport coordinates back to the zoomed interface coordinate system", () => {
    document.documentElement.style.zoom = "1.2";

    expect(getInterfaceZoom()).toBe(1.2);
    expect(viewportValueToInterface(120)).toBe(100);
    expect(viewportValueToInterface(36)).toBe(30);
  });

  it("falls back to one for a missing or invalid zoom", () => {
    expect(getInterfaceZoom()).toBe(1);
    const getComputedStyleMock = vi
      .spyOn(globalThis, "getComputedStyle")
      .mockReturnValue({ zoom: "invalid" } as CSSStyleDeclaration);
    expect(getInterfaceZoom()).toBe(1);
    expect(viewportValueToInterface(120)).toBe(120);
    expect(getComputedStyleMock).toHaveBeenCalledWith(document.documentElement);
    getComputedStyleMock.mockRestore();
  });
});
