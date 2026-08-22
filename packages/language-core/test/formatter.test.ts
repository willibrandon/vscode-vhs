import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatVhs } from "../src/index.js";

describe("formatVhs", () => {
  it("only removes trailing whitespace and keeps command grouping", () => {
    const source = '  Type "hello  world" Sleep 500ms Enter  \n\n# keep this  \n';
    expect(formatVhs(source)).toBe('  Type "hello  world" Sleep 500ms Enter\n\n# keep this\n');
  });

  it("preserves CRLF line endings", () => {
    expect(formatVhs("Set Width 1200  \r\nOutput demo.gif\r\n")).toBe(
      "Set Width 1200\r\nOutput demo.gif\r\n",
    );
  });

  it("is idempotent for arbitrary Unicode text", () => {
    fc.assert(
      fc.property(fc.string(), (source) => {
        const once = formatVhs(source);
        expect(formatVhs(once)).toBe(once);
      }),
    );
  });

  it("handles large runs of whitespace in linear time", () => {
    const source = `Type "hello"${"\t".repeat(100_000)}${"\n".repeat(100_000)}`;
    const started = performance.now();

    expect(formatVhs(source)).toBe('Type "hello"\n');
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
