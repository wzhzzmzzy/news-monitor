import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { configSchema, type ValidConfig } from '../schema/config.js'

export function loadConfig(configPath?: string): ValidConfig {
  const targetPath = configPath || path.resolve(process.cwd(), 'config.yaml')

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Configuration file not found at ${targetPath}`)
  }

  const fileContent = fs.readFileSync(targetPath, 'utf8')
  const rawConfig = yaml.load(fileContent)

  const result = configSchema.safeParse(rawConfig)

  if (!result.success) {
    console.error('Configuration validation failed:')
    result.error.errors.forEach((err) => {
      console.error(`- ${err.path.join('.')}: ${err.message}`)
    })
    throw new Error('Invalid configuration')
  }

  return result.data
}
