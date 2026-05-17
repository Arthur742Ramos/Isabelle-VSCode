import { describe, expect, it } from "vitest";
import {
  buildPideConfigureParams,
  PideConfigurationSource
} from "../../src/pide/pideConfigure";

function makeConfig(values: Record<string, unknown>): PideConfigurationSource {
  return {
    get<T>(key: string, defaultValue: T): T {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        return values[key] as T;
      }
      return defaultValue;
    }
  };
}

describe("buildPideConfigureParams", () => {
  it("defaults to localSyntax and omits scalaIsabelle when settings are empty", () => {
    const params = buildPideConfigureParams(makeConfig({}));

    expect(params).toEqual({ mode: "localSyntax" });
    expect(params).not.toHaveProperty("scalaIsabelle");
  });

  it("normalizes unknown modes back to localSyntax", () => {
    const params = buildPideConfigureParams(
      makeConfig({
        "pide.mode": "qbf-magic",
        "pide.isabelleHome": "/opt/Isabelle2024"
      })
    );

    expect(params).toEqual({ mode: "localSyntax" });
  });

  it("omits scalaIsabelle for localSyntax even when sub-settings are populated", () => {
    const params = buildPideConfigureParams(
      makeConfig({
        "pide.mode": "localSyntax",
        "pide.isabelleHome": "/opt/Isabelle2024",
        "pide.userDir": "/home/user/.isabelle",
        "pide.sessionName": "MySession",
        "pide.logicSession": "HOL-Library"
      })
    );

    expect(params).toEqual({ mode: "localSyntax" });
    expect(params).not.toHaveProperty("scalaIsabelle");
  });

  it("includes scalaIsabelle sub-parameters when mode is scalaIsabelle", () => {
    const params = buildPideConfigureParams(
      makeConfig({
        "pide.mode": "scalaIsabelle",
        "pide.isabelleHome": "/opt/Isabelle2024",
        "pide.userDir": "/home/user/.isabelle",
        "pide.sessionName": "MySession",
        "pide.logicSession": "HOL-Analysis"
      })
    );

    expect(params).toEqual({
      mode: "scalaIsabelle",
      scalaIsabelle: {
        isabelleHome: "/opt/Isabelle2024",
        userDir: "/home/user/.isabelle",
        sessionName: "MySession",
        logicSession: "HOL-Analysis"
      }
    });
  });

  it("falls back to HOL logicSession when not configured", () => {
    const params = buildPideConfigureParams(
      makeConfig({
        "pide.mode": "scalaIsabelle"
      })
    );

    expect(params).toEqual({
      mode: "scalaIsabelle",
      scalaIsabelle: {
        logicSession: "HOL"
      }
    });
  });

  it("omits optional scalaIsabelle fields whose values are blank strings", () => {
    const params = buildPideConfigureParams(
      makeConfig({
        "pide.mode": "scalaIsabelle",
        "pide.isabelleHome": "  ",
        "pide.userDir": "",
        "pide.sessionName": "\t\n",
        "pide.logicSession": ""
      })
    );

    expect(params).toEqual({
      mode: "scalaIsabelle",
      scalaIsabelle: {
        logicSession: "HOL"
      }
    });
  });

  it("trims surrounding whitespace from populated scalaIsabelle fields", () => {
    const params = buildPideConfigureParams(
      makeConfig({
        "pide.mode": "scalaIsabelle",
        "pide.isabelleHome": "  /opt/Isabelle2024  ",
        "pide.logicSession": "  HOL-Library "
      })
    );

    expect(params).toEqual({
      mode: "scalaIsabelle",
      scalaIsabelle: {
        isabelleHome: "/opt/Isabelle2024",
        logicSession: "HOL-Library"
      }
    });
  });
});
