import { describe, expect, it } from "vitest";
import {
  fileManagerNameForUserAgent,
  revealInFileManagerLabelForUserAgent,
} from "./platform";

describe("native file-manager labels", () => {
  it("uses Finder on macOS", () => {
    const userAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

    expect(fileManagerNameForUserAgent(userAgent)).toBe("Finder");
    expect(revealInFileManagerLabelForUserAgent(userAgent)).toBe(
      "Reveal in Finder",
    );
  });

  it("uses Explorer on Windows", () => {
    const userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

    expect(fileManagerNameForUserAgent(userAgent)).toBe("Explorer");
    expect(revealInFileManagerLabelForUserAgent(userAgent)).toBe(
      "Reveal in Explorer",
    );
  });

  it("keeps a generic file-manager fallback on Linux", () => {
    const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";

    expect(fileManagerNameForUserAgent(userAgent)).toBe("File Manager");
    expect(revealInFileManagerLabelForUserAgent(userAgent)).toBe(
      "Reveal in File Manager",
    );
  });
});
