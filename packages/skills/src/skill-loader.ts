import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Skill {
  id: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
}

export interface SkillLoaderOptions {
  skillsDir: string;
}

export class SkillLoader {
  private readonly skillsDir: string;

  constructor(options: SkillLoaderOptions) {
    this.skillsDir = options.skillsDir;
  }

  async load(id: string): Promise<Skill> {
    const dir = join(this.skillsDir, id);
    const [prompt, schemaRaw] = await Promise.all([
      readFile(join(dir, "SKILL.md"), "utf8"),
      readFile(join(dir, "output.schema.json"), "utf8")
    ]);
    return { id, prompt, outputSchema: JSON.parse(schemaRaw) as Record<string, unknown> };
  }
}
