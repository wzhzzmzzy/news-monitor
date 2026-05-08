import { z } from "zod";

export const ThinkingSchema = z.enum(["minimal", "low", "medium", "high"]);
export const ThemeVariantSchema = z.enum(["latte", "frappe", "macchiato", "mocha"]);
export const ThemeModeSchema = z.enum(["light", "dark"]);

export const NewsSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.literal("newsnow"),
  sourceId: z.string().min(1),
  weight: z.number().min(0).max(1).default(1),
  enabled: z.boolean().default(true)
});

export const AnalysisProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  focus: z.array(z.string().min(1)),
  instruction: z.string().min(1),
  default: z.boolean().default(false)
});

export const SourcesConfigSchema = z.array(NewsSourceSchema);
export const AnalysisProfilesConfigSchema = z.array(AnalysisProfileSchema);

export type ThinkingEffort = z.infer<typeof ThinkingSchema>;
export type ThemeVariant = z.infer<typeof ThemeVariantSchema>;
export type ThemeMode = z.infer<typeof ThemeModeSchema>;
export type NewsSourceConfig = z.infer<typeof NewsSourceSchema>;
export type AnalysisProfile = z.infer<typeof AnalysisProfileSchema>;

export interface RuntimeConfig {
  llm: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    thinking?: ThinkingEffort;
    timeoutMs: number;
    maxToolIterations: number;
  };
  flash: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    thinking?: ThinkingEffort;
    timeoutMs: number;
  };
  newsnow: {
    baseUrl?: string;
    timeoutMs: number;
    maxItemsPerSource: number;
  };
  theme: {
    mode: ThemeMode;
    lightVariant: ThemeVariant;
    darkVariant: ThemeVariant;
  };
  gateway: {
    host: string;
    port: number;
    openBrowserOnStart: boolean;
  };
}

export interface HotBoardConfig {
  sources: NewsSourceConfig[];
  analysisProfiles: AnalysisProfile[];
}
