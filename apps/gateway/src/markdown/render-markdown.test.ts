import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render-markdown.js";

describe("renderMarkdown", () => {
  it("renders markdown tables and links", () => {
    const html = renderMarkdown("| A | B |\n| - | - |\n| [x](https://example.com) | `code` |");
    expect(html).toContain("<table>");
    expect(html).toContain("<a href=\"https://example.com\"");
    expect(html).toContain("<code>code</code>");
  });

  it("removes dangerous html", () => {
    const html = renderMarkdown("<img src=x onerror=alert(1)>\\n<script>alert(1)</script>");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
  });
});
