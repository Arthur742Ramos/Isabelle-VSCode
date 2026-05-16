import { describe, expect, it } from "vitest";
import { formatUserVisibleError, truncateForNotification } from "../../src/ui/errorMessages";

describe("error message formatting", () => {
  it("keeps the full message for output while truncating notifications", () => {
    const message = "x".repeat(20);

    expect(formatUserVisibleError("Unable to build", new Error(message), 12)).toEqual({
      logMessage: `Unable to build: ${message}`,
      notificationMessage: "Unable to build: xxxxxxxxx..."
    });
  });

  it("formats non-Error failures", () => {
    expect(formatUserVisibleError("Unable to check", "backend unavailable")).toEqual({
      logMessage: "Unable to check: backend unavailable",
      notificationMessage: "Unable to check: backend unavailable"
    });
  });

  it("handles very small notification limits", () => {
    expect(truncateForNotification("abcdef", 2)).toBe("..");
  });
});
