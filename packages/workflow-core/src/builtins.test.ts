import { describe, expect, it } from "vitest";
import { builtinWorkflows } from "./builtins.js";

describe("builtinWorkflows", () => {
  it("定义日报和半周报 workflow", () => {
    expect(builtinWorkflows.daily_news_report.defaultInput).toMatchObject({
      reportType: "daily",
      windowHours: 24,
      analysisProfileId: "default"
    });
    expect(builtinWorkflows.semiweekly_news_report.defaultInput).toMatchObject({
      reportType: "semiweekly",
      windowHours: 96,
      analysisProfileId: "default"
    });
    expect(builtinWorkflows.daily_news_report.steps.map((step) => step.id)).toEqual([
      "crawl_news",
      "annotate_news",
      "generate_report"
    ]);
  });
});
