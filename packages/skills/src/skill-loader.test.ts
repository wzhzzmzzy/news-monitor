import { describe, expect, it } from "vitest";
import { SkillLoader } from "./skill-loader.js";

describe("SkillLoader", () => {
  it("加载内置 skill 的 prompt 和输出 schema", async () => {
    const loader = new SkillLoader({ skillsDir: "packages/skills/skills" });
    const skill = await loader.load("analyze-hot-topics");

    expect(skill.id).toBe("analyze-hot-topics");
    expect(skill.prompt).toContain("为新闻增加热点评分");
    expect(skill.outputSchema).toMatchObject({
      type: "object",
      required: ["annotations", "topics"]
    });
  });
});
