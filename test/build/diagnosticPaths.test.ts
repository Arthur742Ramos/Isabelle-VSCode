import * as path from "path";
import { describe, expect, it } from "vitest";
import { resolveDiagnosticPath } from "../../src/build/diagnosticPaths";

describe("resolveDiagnosticPath", () => {
  it("resolves relative diagnostic paths against the build directory", () => {
    expect(resolveDiagnosticPath("Foo.thy", "C:\\work\\Session")).toBe(path.resolve("C:\\work\\Session", "Foo.thy"));
  });

  it("keeps absolute diagnostic paths unchanged", () => {
    expect(resolveDiagnosticPath("C:\\work\\Foo.thy", "C:\\other")).toBe("C:\\work\\Foo.thy");
  });
});
