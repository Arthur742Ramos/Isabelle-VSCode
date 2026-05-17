import { describe, expect, it } from "vitest";
import { buildRepairVerificationPlanMarkdown } from "../../src/repair/verificationPlan";

describe("buildRepairVerificationPlanMarkdown", () => {
  it("creates an active-session plan without claiming that the patch was applied or verified", () => {
    const markdown = buildRepairVerificationPlanMarkdown({
      capturedAt: "2026-05-16T21:00:00.000Z",
      workspaceFolder: "C:\\work",
      patchPath: "C:\\work\\repair.patch",
      patches: [{ relativePath: "Foo.thy", hunkCount: 2 }],
      verification: {
        session: {
          name: "HOL-Foo",
          parent: "HOL",
          rootDirectory: "C:\\work",
          sessionDirectory: "C:\\work\\Foo"
        },
        build: {
          command: "isabelle",
          args: ["build", "-d", "C:\\work", "-d", "C:\\work\\Foo", "-v", "HOL-Foo"],
          workingDirectory: "C:\\work\\Foo"
        }
      }
    });

    expect(markdown).toContain("Not verified yet");
    expect(markdown).toContain("no patch contents were applied");
    expect(markdown).toContain("no files were written");
    expect(markdown).toContain("no Isabelle build was run by the preview command");
    expect(markdown).toContain("`Foo.thy` (2 hunks)");
    expect(markdown).toContain("`isabelle build -d C:\\work -d C:\\work\\Foo -v HOL-Foo`");
    expect(markdown).toContain("apply the trusted patch manually");
    expect(markdown).not.toContain("Isabelle build succeeded");
  });

  it("falls back to explicit instructions when no active session is selected", () => {
    const markdown = buildRepairVerificationPlanMarkdown({
      capturedAt: "2026-05-16T21:00:00.000Z",
      workspaceFolder: "C:\\work",
      patches: [{ relativePath: "Foo.thy", hunkCount: 1 }]
    });

    expect(markdown).toContain("No active Isabelle session was selected");
    expect(markdown).toContain("Select an active session");
    expect(markdown).toContain("Until that build succeeds, the repair is not verified");
    expect(markdown).not.toContain("Command line:");
  });
});
