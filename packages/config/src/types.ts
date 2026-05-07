import { z } from "zod";

export const NewsSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.literal("newsnow"),
  sourceId: z.string().min(1).optional(),
  url: z.string().url().optional(),
  weight: z.number().min(0).max(1).default(1)
});

export const AnalysisProfileSchema = z.object({
  id: z.string().min(1),
  focus: z.array(z.string().min(1)),
  instruction: z.string().min(1)
});

export const SourcesConfigSchema = z.array(NewsSourceSchema);
export const AnalysisProfilesConfigSchema = z.array(AnalysisProfileSchema);

export type NewsSourceConfig = z.infer<typeof NewsSourceSchema>;
export type AnalysisProfile = z.infer<typeof AnalysisProfileSchema>;

export interface HotBoardConfig {
  sources: NewsSourceConfig[];
  analysisProfiles: AnalysisProfile[];
}
