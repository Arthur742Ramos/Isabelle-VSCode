import { describe, expect, it } from "vitest";
import { createUnifiedDiffPreviews, normalizePatchPath, RepairPatchError } from "../../src/repair/unifiedDiff";

describe("unified repair diff preview", () => {
  it("creates a readonly preview by applying a conservative unified diff", () => {
    const previews = createUnifiedDiffPreviews(
      [
        "diff --git a/Foo.thy b/Foo.thy",
        "--- a/Foo.thy",
        "+++ b/Foo.thy",
        "@@ -1,3 +1,3 @@",
        " theory Foo",
        "-lemma bad: A",
        "+lemma good: A",
        " end",
        ""
      ].join("\n"),
      {
        "Foo.thy": "theory Foo\nlemma bad: A\nend\n"
      }
    );

    expect(previews).toEqual([
      {
        relativePath: "Foo.thy",
        proposedText: "theory Foo\nlemma good: A\nend\n",
        hunkCount: 1
      }
    ]);
  });

  it("normalizes context matching while preserving CRLF output", () => {
    const previews = createUnifiedDiffPreviews(
      [
        "--- a/Foo.thy",
        "+++ b/Foo.thy",
        "@@ -1,2 +1,2 @@",
        " theory Foo",
        "-lemma bad: A",
        "+lemma good: A",
        ""
      ].join("\n"),
      {
        "Foo.thy": "theory Foo\r\nlemma bad: A\r\n"
      }
    );

    expect(previews[0].proposedText).toBe("theory Foo\r\nlemma good: A\r\n");
  });

  it("rejects path traversal", () => {
    expect(() => normalizePatchPath("a/../Secrets.thy")).toThrow(RepairPatchError);
  });

  it("rejects added or deleted files", () => {
    expect(() =>
      createUnifiedDiffPreviews(
        [
          "--- /dev/null",
          "+++ b/New.thy",
          "@@ -0,0 +1,1 @@",
          "+theory New",
          ""
        ].join("\n"),
        {}
      )
    ).toThrow("added or deleted files");
  });

  it("rejects mismatched context instead of producing a misleading preview", () => {
    expect(() =>
      createUnifiedDiffPreviews(
        [
          "--- a/Foo.thy",
          "+++ b/Foo.thy",
          "@@ -1,2 +1,2 @@",
          " theory Foo",
          "-lemma bad: A",
          "+lemma good: A",
          ""
        ].join("\n"),
        {
          "Foo.thy": "theory Foo\nlemma already_changed: A\n"
        }
      )
    ).toThrow("Patch context does not match Foo.thy at line 2");
  });

  it("rejects unsupported no-newline markers", () => {
    expect(() =>
      createUnifiedDiffPreviews(
        [
          "--- a/Foo.thy",
          "+++ b/Foo.thy",
          "@@ -1,1 +1,1 @@",
          "-theory Foo",
          "+theory Foo",
          "\\ No newline at end of file"
        ].join("\n"),
        {
          "Foo.thy": "theory Foo"
        }
      )
    ).toThrow("no-newline markers");
  });
});
