import { describe, expect, it } from "vitest";
import { catppuccinThemes, getThemeTokens, themeToCssVariables } from "./index.js";

describe("theme tokens", () => {
  it("provides required Catppuccin variants", () => {
    expect(Object.keys(catppuccinThemes)).toEqual(["latte", "frappe", "macchiato", "mocha"]);
  });

  it("returns CSS variables for web UI", () => {
    const css = themeToCssVariables(getThemeTokens("latte"));
    expect(css).toContain("--base:");
    expect(css).toContain("--mantle:");
    expect(css).toContain("--surface0:");
    expect(css).toContain("--text:");
    expect(css).toContain("--blue:");
  });
});
