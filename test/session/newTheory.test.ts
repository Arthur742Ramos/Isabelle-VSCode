import { describe, expect, it } from "vitest";
import {
  buildTheoryFileContent,
  isValidTheoryName,
  sanitizeTheoryName,
  theoryFileName
} from "../../src/session/newTheory";

describe("isValidTheoryName", () => {
  it("accepts legal Isabelle theory names", () => {
    for (const name of ["Main", "Foo", "My_Theory", "T1", "A'", "List_Ext"]) {
      expect(isValidTheoryName(name), name).toBe(true);
    }
  });

  it("rejects illegal names", () => {
    for (const name of ["", "1Foo", "_Foo", "Foo Bar", "Foo.thy", "Foo-Bar", "Fo/o", "with spaces"]) {
      expect(isValidTheoryName(name), name).toBe(false);
    }
  });
});

describe("sanitizeTheoryName", () => {
  it("strips a path and the .thy extension", () => {
    expect(sanitizeTheoryName("C:/work/Foo.thy")).toBe("Foo");
    expect(sanitizeTheoryName("/home/me/Bar.thy")).toBe("Bar");
    expect(sanitizeTheoryName("Baz.thy")).toBe("Baz");
  });

  it("replaces illegal characters with underscores", () => {
    expect(sanitizeTheoryName("My Theory")).toBe("My_Theory");
    expect(sanitizeTheoryName("a-b-c")).toBe("a_b_c");
  });

  it("prefixes a letter when the name starts with a digit", () => {
    expect(sanitizeTheoryName("123")).toBe("T123");
    expect(sanitizeTheoryName("9lives")).toBe("T9lives");
  });

  it("trims leading and trailing underscores from the cleaned name", () => {
    expect(sanitizeTheoryName("  -foo-  ")).toBe("foo");
  });

  it("returns undefined when nothing usable remains", () => {
    expect(sanitizeTheoryName("")).toBeUndefined();
    expect(sanitizeTheoryName("   ")).toBeUndefined();
    expect(sanitizeTheoryName("...")).toBeUndefined();
  });

  it("produces a name that always validates when defined", () => {
    for (const input of ["Foo.thy", "my theory", "123", "a-b", "  Weird@Name!  "]) {
      const result = sanitizeTheoryName(input);
      if (result !== undefined) {
        expect(isValidTheoryName(result), `${input} -> ${result}`).toBe(true);
      }
    }
  });
});

describe("buildTheoryFileContent", () => {
  it("renders a header matching the theory name with begin/end", () => {
    const content = buildTheoryFileContent({ name: "Foo" });
    expect(content).toBe("theory Foo\n  imports Main\nbegin\n\n\nend\n");
  });

  it("defaults imports to Main and joins multiple imports", () => {
    expect(buildTheoryFileContent({ name: "Foo", imports: [] })).toContain("imports Main");
    expect(buildTheoryFileContent({ name: "Foo", imports: ["Main", "List"] })).toContain("imports Main List");
  });

  it("ends with a trailing newline", () => {
    expect(buildTheoryFileContent({ name: "Bar" }).endsWith("\n")).toBe(true);
  });
});

describe("theoryFileName", () => {
  it("appends the .thy extension", () => {
    expect(theoryFileName("Foo")).toBe("Foo.thy");
  });
});
