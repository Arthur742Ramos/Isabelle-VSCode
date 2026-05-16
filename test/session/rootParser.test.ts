import { describe, expect, it } from "vitest";
import { parseRootFile, parseRootsFile } from "../../src/session/rootParser";

describe("parseRootFile", () => {
  it("extracts sessions, parents, imported sessions, theories, and document files", () => {
    const sessions = parseRootFile(
      `
      chapter Test

      session My_Session = HOL +
        sessions
          "HOL-Library"
        theories [document = false]
          Foo
          Bar.Baz
        document_files
          "root.tex"
      `,
      "C:\\work"
    );

    expect(sessions).toEqual([
      {
        name: "My_Session",
        parent: "HOL",
        rootDirectory: "C:\\work",
        sessionDirectory: "C:\\work",
        theories: [{ name: "Foo" }, { name: "Bar.Baz" }],
        importedSessions: ["HOL-Library"],
        directories: [],
        documentFiles: ["root.tex"]
      }
    ]);
  });

  it("extracts session directories and theory directories", () => {
    const sessions = parseRootFile(
      `
      session Grouped (AFP) in "thys" = HOL +
        directories "More"
        theories Foo
      `,
      "C:\\work"
    );

    expect(sessions[0]).toMatchObject({
      name: "Grouped",
      parent: "HOL",
      rootDirectory: "C:\\work",
      sessionDirectory: "C:\\work\\thys",
      directories: ["More"],
      theories: [{ name: "Foo" }]
    });
  });

  it("ignores nested Isabelle comments", () => {
    const sessions = parseRootFile(
      `
      (* outer (* inner *) ignored *)
      session Visible = HOL +
        theories Main
      `,
      "C:\\work"
    );

    expect(sessions.map((session) => session.name)).toEqual(["Visible"]);
  });
});

describe("parseRootsFile", () => {
  it("extracts non-empty roots and ignores shell comments", () => {
    expect(parseRootsFile('AFP\n"More Roots"\n# ignored\n')).toEqual(["AFP", "More Roots"]);
  });
});
