import { describe, expect, it } from "vitest";
import { summarizeStartupValidationErrors } from "../startupLog";

describe("startup validation logging", () => {
  it("bounds restored hash-chain error output", () => {
    const errors = Array.from({ length: 12 }, (_, index) => `Event ${index + 1} hash mismatch`);

    expect(summarizeStartupValidationErrors(errors, 5)).toEqual({
      errorCount: 12,
      firstErrors: [
        "Event 1 hash mismatch",
        "Event 2 hash mismatch",
        "Event 3 hash mismatch",
        "Event 4 hash mismatch",
        "Event 5 hash mismatch"
      ],
      truncatedCount: 7
    });
  });
});
