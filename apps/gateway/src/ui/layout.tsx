import { getThemeTokens, themeToCssVariables, type ThemeVariant } from "../../../../packages/theme/src/index.js";

export function HtmlDocument(props: {
  title: string;
  variant: ThemeVariant;
  mode: "light" | "dark";
  lightVariant?: ThemeVariant;
  darkVariant?: ThemeVariant;
  children: unknown;
  script: "/assets/chat.js" | "/assets/settings.js";
}) {
  const tokens = getThemeTokens(props.variant);
  return (
    <html
      lang="zh-CN"
      data-theme-mode={props.mode}
      data-theme-variant={props.variant}
      data-theme-light-variant={props.lightVariant ?? "latte"}
      data-theme-dark-variant={props.darkVariant ?? "mocha"}
    >
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <style>{`:root{${themeToCssVariables(tokens)}}`}</style>
        <link rel="stylesheet" href="/assets/styles.css" />
      </head>
      <body>
        {props.children}
        <script type="module" src={props.script}></script>
      </body>
    </html>
  );
}
