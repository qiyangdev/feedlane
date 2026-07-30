import { describe, expect, it } from "vitest";

import { etagsWeaklyMatch } from "../scripts/http-cache.mjs";

describe("HTTP cache validators", () => {
  it.each([
    ['"digest"', '"digest"'],
    ['W/"digest"', '"digest"'],
    ['"digest"', 'W/"digest"'],
  ])("weakly matches equivalent ETags: %s and %s", (left, right) => {
    expect(etagsWeaklyMatch(left, right)).toBe(true);
  });

  it.each([
    ['"first"', '"second"'],
    [null, '"digest"'],
    ['"digest"', null],
  ])("rejects different or missing ETags: %s and %s", (left, right) => {
    expect(etagsWeaklyMatch(left, right)).toBe(false);
  });
});
