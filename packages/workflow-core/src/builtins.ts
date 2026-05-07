import type { WorkflowDefinition } from "./types.js";

const reportSteps: WorkflowDefinition["steps"] = [
  {
    id: "crawl_news",
    kind: "tool",
    uses: "crawl_news",
    output: "news.raw"
  },
  {
    id: "annotate_news",
    kind: "llm",
    skill: "analyze-hot-topics",
    input: "news.raw",
    output: ["news.annotated", "topics.index"],
    outputSchema: "skills/analyze-hot-topics/output.schema.json"
  },
  {
    id: "generate_report",
    kind: "llm",
    skill: "generate-report",
    input: ["news.annotated", "topics.index"],
    output: "reports",
    outputSchema: "skills/generate-report/output.schema.json"
  }
];

export const builtinWorkflows = {
  daily_news_report: {
    id: "daily_news_report",
    defaultInput: {
      reportType: "daily",
      windowHours: 24,
      analysisProfileId: "default"
    },
    steps: reportSteps
  },
  semiweekly_news_report: {
    id: "semiweekly_news_report",
    defaultInput: {
      reportType: "semiweekly",
      windowHours: 96,
      analysisProfileId: "default"
    },
    steps: reportSteps
  }
} satisfies Record<string, WorkflowDefinition>;
