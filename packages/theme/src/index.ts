export type ThemeVariant = "latte" | "frappe" | "macchiato" | "mocha";
export type ThemeMode = "light" | "dark";

export interface ThemeTokens {
  base: string;
  mantle: string;
  crust: string;
  surface0: string;
  surface1: string;
  text: string;
  subtext0: string;
  green: string;
  yellow: string;
  red: string;
  blue: string;
  mauve: string;
}

export const catppuccinThemes: Record<ThemeVariant, ThemeTokens> = {
  latte: {
    base: "#eff1f5",
    mantle: "#e6e9ef",
    crust: "#dce0e8",
    surface0: "#ccd0da",
    surface1: "#bcc0cc",
    text: "#4c4f69",
    subtext0: "#6c6f85",
    green: "#40a02b",
    yellow: "#df8e1d",
    red: "#d20f39",
    blue: "#1e66f5",
    mauve: "#8839ef"
  },
  frappe: {
    base: "#303446",
    mantle: "#292c3c",
    crust: "#232634",
    surface0: "#414559",
    surface1: "#51576d",
    text: "#c6d0f5",
    subtext0: "#a5adce",
    green: "#a6d189",
    yellow: "#e5c890",
    red: "#e78284",
    blue: "#8caaee",
    mauve: "#ca9ee6"
  },
  macchiato: {
    base: "#24273a",
    mantle: "#1e2030",
    crust: "#181926",
    surface0: "#363a4f",
    surface1: "#494d64",
    text: "#cad3f5",
    subtext0: "#a5adcb",
    green: "#a6da95",
    yellow: "#eed49f",
    red: "#ed8796",
    blue: "#8aadf4",
    mauve: "#c6a0f6"
  },
  mocha: {
    base: "#1e1e2e",
    mantle: "#181825",
    crust: "#11111b",
    surface0: "#313244",
    surface1: "#45475a",
    text: "#cdd6f4",
    subtext0: "#a6adc8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    red: "#f38ba8",
    blue: "#89b4fa",
    mauve: "#cba6f7"
  }
};

export function getThemeTokens(variant: ThemeVariant): ThemeTokens {
  return catppuccinThemes[variant];
}

export function themeToCssVariables(tokens: ThemeTokens): string {
  return Object.entries(tokens)
    .map(([name, value]) => `--${name}: ${value};`)
    .join("\n");
}
