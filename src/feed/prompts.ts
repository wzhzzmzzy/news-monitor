import fs from 'node:fs'
import yaml from 'js-yaml'
import { z } from 'zod'

const text = z.string().trim().min(1).max(20000)
export const promptsSchema = z.object({ common: text, translate: text, summaryPart: text, reduce: text, retry: text })
// Both src/feed and dist/feed resolve the same editable repository configuration.
export const defaultPrompts = promptsSchema.parse((yaml.load(fs.readFileSync(new URL('../../config/prompts.yaml', import.meta.url), 'utf8')) as { prompts: unknown }).prompts)
export const LEGACY_PROMPTS_HASH = '1e67a87385113d42cf0b36aaf2e1bfc6751613ea1cb298ba18e5d15cf66e47f5'
