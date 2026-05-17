import { describe, expect, it } from "vitest";
import { buildRepairRequestMarkdown } from "../../src/repair/repairRequest";

describe("buildRepairRequestMarkdown", () => {
  it("captures diagnostics and proof context without implying automatic repair", () => {
    const markdown = buildRepairRequestMarkdown({
      capturedAt: "2026-05-16T20:00:00.000Z",
      documentUri: "file:///C:/work/Foo.thy",
      documentPath: "C:\\work\\Foo.thy",
      documentVersion: 7,
      cursor: { line: 4, character: 2 },
      diagnostics: [
        {
          severity: "error",
          source: "isabelle build",
          message: "Failed to finish proof",
          range: {
            startLine: 3,
            startCharacter: 1,
            endLine: 3,
            endCharacter: 5
          }
        }
      ],
      proofState: {
        uri: "file:///C:/work/Foo.thy",
        version: 7,
        status: "ready",
        command: {
          id: "c1",
          kind: "lemma",
          name: "foo",
          status: "failed",
          range: {
            start: { line: 3, character: 0 },
            end: { line: 6, character: 0 }
          }
        },
        context: [{ kind: "assumption", name: "h", value: "A" }],
        goals: [{ index: 1, text: "A ==> B" }],
        raw: "goal (1 subgoal)"
      }
    });

    expect(markdown).toContain("No external AI service has been called");
    expect(markdown).toContain("- Version: 7");
    expect(markdown).toContain("**error** (isabelle build) at 4:2-4:6");
    expect(markdown).toContain("Failed to finish proof");
    expect(markdown).toContain("`lemma foo`");
    expect(markdown).toContain("A ==> B");
    expect(markdown).toContain("read-only, rejects unsafe patch shapes");
    expect(markdown).toContain("verification plan with active-session build details when available");
  });

  it("records unavailable proof state explicitly", () => {
    const markdown = buildRepairRequestMarkdown({
      capturedAt: "2026-05-16T20:00:00.000Z",
      documentUri: "file:///C:/work/Foo.thy",
      documentPath: "C:\\work\\Foo.thy",
      documentVersion: 1,
      cursor: { line: 0, character: 0 },
      diagnostics: [],
      proofState: {
        uri: "file:///C:/work/Foo.thy",
        version: 1,
        status: "unavailable",
        context: [],
        goals: [],
        raw: "",
        message: "backend unavailable"
      }
    });

    expect(markdown).toContain("No diagnostics were reported");
    expect(markdown).toContain("- Status: unavailable");
    expect(markdown).toContain("- Message: backend unavailable");
  });
});
