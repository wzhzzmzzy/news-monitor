import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FeedConfig } from './config.js'

export type LlmConfig = NonNullable<FeedConfig['llm']>
interface PiModel { id: string; api?: string; headers?: Record<string, unknown> }
interface PiProvider {
  api?: string
  baseUrl?: string
  apiKey?: unknown
  headers?: Record<string, unknown>
  authHeader?: boolean
  models?: PiModel[]
}

// Read Pi's provider at runtime: never copy its credentials into project files.
// Credential commands are deliberately unsupported; use a literal or env name.
function credential(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  if (value.startsWith('!')) throw new Error('Pi credential commands are unsupported; use an environment variable reference')
  return process.env[value] || (/^[A-Z][A-Z0-9_]*$/.test(value) ? undefined : value)
}

export function resolveLlm(config: LlmConfig) {
  if (!config.piProvider) return { model: config.model, baseURL: config.baseUrl, apiKey: process.env[config.apiKeyEnv] }
  const file = config.piModelsPath?.replace(/^~\//, `${os.homedir()}/`) || path.join(os.homedir(), '.pi', 'agent', 'models.json')
  let providers: Record<string, PiProvider>
  try { providers = JSON.parse(fs.readFileSync(file, 'utf8')).providers || {} }
  catch { throw new Error('Cannot read Pi models configuration; check llm.piModelsPath') }
  const provider = providers[config.piProvider]
  const model = provider?.models?.find(model => model.id === config.model)
  if (!provider || !model) throw new Error('The configured Pi provider/model does not exist')
  if ((model.api || provider.api) !== 'openai-completions') throw new Error('This integration requires a Pi openai-completions provider')
  if (!/^https?:\/\//.test(provider.baseUrl || '')) throw new Error('Pi provider requires an HTTP(S) baseUrl')
  if (Object.keys(provider.headers || {}).length || Object.keys(model.headers || {}).length || provider.authHeader === false) {
    throw new Error('Custom Pi headers/auth modes are unsupported; use an environment-based llm configuration')
  }
  return { model: config.model, baseURL: provider.baseUrl as string, apiKey: credential(provider.apiKey) }
}

export function requireLlm(config: FeedConfig['llm']) {
  if (!config) throw new Error('Configure llm for Chinese translation and summaries or --analyze')
  const resolved = resolveLlm(config)
  if (!resolved.apiKey) throw new Error(config.piProvider ? 'Pi provider has no usable API key' : `Set ${config.apiKeyEnv} before using the model`)
  return resolved
}
