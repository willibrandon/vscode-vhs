import { describe, expect, it } from "vitest";
import {
  manifestIdentityFailures,
  marketplaceIdentityFailures,
  openVsxIdentityFailures,
} from "../../scripts/check-registry-identity.mjs";

const expected = { name: "vhs-tape", publisher: "willibrandon" };

describe("registry identity checks", () => {
  it("requires the fixed package identity before making registry requests", () => {
    expect(manifestIdentityFailures(expected, expected)).toEqual([]);
    expect(manifestIdentityFailures({ name: "vhs", publisher: "willibrandon" }, expected)).toEqual([
      "package.json must identify willibrandon.vhs-tape.",
    ]);
  });

  it("rejects an exact Marketplace package owned by another publisher", () => {
    expect(
      marketplaceIdentityFailures(
        [{ extensionName: "vhs-tape", publisher: { publisherName: "someone-else" } }],
        expected,
      ),
    ).toEqual(["Marketplace package vhs-tape is already owned by someone-else, not willibrandon."]);
  });

  it("accepts an available package or the publisher's existing package", () => {
    expect(marketplaceIdentityFailures([], expected)).toEqual([]);
    expect(
      marketplaceIdentityFailures(
        [
          { extensionName: "vhs-tape", publisher: { publisherName: "willibrandon" } },
          { extensionName: "something-else", publisher: { publisherName: "someone-else" } },
        ],
        expected,
      ),
    ).toEqual([]);
  });

  it("accepts an available Open VSX route or the expected package", () => {
    expect(openVsxIdentityFailures(undefined, expected)).toEqual([]);
    expect(
      openVsxIdentityFailures({ name: "vhs-tape", namespace: "willibrandon" }, expected),
    ).toEqual([]);
  });

  it("rejects malformed registry responses", () => {
    expect(marketplaceIdentityFailures({}, expected)).not.toEqual([]);
    expect(openVsxIdentityFailures([], expected)).not.toEqual([]);
  });
});
