import { describe, expect, it } from "vitest";
import { parseVhs } from "../src/index.js";

describe("parser performance", () => {
  it("parses a 10,000-command tape without pathological runtime", () => {
    const source = Array.from({ length: 10_000 }, (_, index) => `Type "line ${index}" Enter`).join(
      "\n",
    );
    const started = performance.now();
    const document = parseVhs(source);
    const elapsed = performance.now() - started;

    expect(document.commands).toHaveLength(20_000);
    expect(document.diagnostics).toEqual([]);
    expect(elapsed).toBeLessThan(1_000);
  });
});
