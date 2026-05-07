import OpenAI from "openai";
import type { ModelClient } from "../../workflow-core/src/index.js";

export interface OpenAIModelClientOptions {
  apiKey?: string;
  model?: string;
}

export class OpenAIModelClient implements ModelClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIModelClientOptions = {}) {
    this.client = new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY });
    const model = options.model ?? process.env.OPENAI_MODEL;
    if (!model) {
      throw new Error("必须提供 OpenAI model。请传入 model 或设置 OPENAI_MODEL。");
    }
    this.model = model;
  }

  async generateStructured(input: { system: string; user: string; schema: Record<string, unknown> }): Promise<unknown> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "hot_board_output",
          schema: input.schema,
          strict: true
        }
      }
    });

    const text = response.choices[0]?.message.content;
    if (!text) {
      throw new Error("OpenAI chat completion 没有包含 message content");
    }
    return JSON.parse(text);
  }
}
