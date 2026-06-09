import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..", "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  icon?: string;
  galleryBanner?: { color?: string; theme?: string };
};

describe("extension icon manifest", () => {
  it("references a bundled icon", () => {
    expect(packageJson.icon).toBe("media/icon.png");
  });

  it("ships the icon file as a 128x128 PNG", () => {
    const iconPath = resolve(root, packageJson.icon as string);
    expect(existsSync(iconPath), `${packageJson.icon} should exist`).toBe(true);

    const bytes = readFileSync(iconPath);
    const signature = bytes.subarray(0, 8).toString("hex");
    expect(signature, "icon should be a PNG").toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16), "icon width").toBe(128);
    expect(bytes.readUInt32BE(20), "icon height").toBe(128);
  });

  it("sets a gallery banner that matches the icon", () => {
    expect(packageJson.galleryBanner?.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(packageJson.galleryBanner?.theme).toBe("dark");
  });
});
