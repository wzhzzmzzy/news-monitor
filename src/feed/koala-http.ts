import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

type CurlRunner = (args: string[], config: string, signal?: AbortSignal | null) => Promise<string>
const runCurl: CurlRunner = (args, config, signal) => new Promise((resolve, reject) => {
  const child = spawn('curl', args, { env: process.env, ...(signal ? { signal } : {}) })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  // curl diagnostics can contain authentication or proxy data; report only a safe failure.
  child.stderr.resume()
  child.on('error', () => reject(new Error('Koalablog HTTP transport failed')))
  child.on('close', code => code === 0 ? resolve(output) : reject(new Error('Koalablog HTTP transport failed; reconcile before retry')))
  child.stdin.on('error', () => {})
  child.stdin.end(config)
})

/** HTTP/1.1 transport used by the scheduled briefing; credentials stay off argv and disk. */
export function koalaHttp(run: CurlRunner = runCurl): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(String(input))
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Expected a credential-free HTTPS URL')
    if (init.body && typeof init.body !== 'string') throw new Error('Expected a JSON string body')
    const method = (init.method || 'GET').toUpperCase()
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'news-feed-http-'))
    const file = path.join(dir, 'response')
    const args = ['-q', '--http1.1', '--config', '-', '--silent', '--show-error', '--compressed', '--connect-timeout', '10', '--max-time', '30', '--request', method, '--url', url.href, '--output', file, '--write-out', '%{http_code}']
    // curl clears the output file between safe read retries. Writes are attempted exactly once.
    if (method === 'GET') args.push('--retry', '2', '--retry-delay', '1', '--retry-all-errors')
    const config = [...new Headers(init.headers)].map(([key, value]) => `header = ${JSON.stringify(`${key}: ${value}`)}`)
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
    if (proxy) config.push(`proxy = ${JSON.stringify(proxy)}`, 'noproxy = ""')
    if (typeof init.body === 'string') config.push(`data = ${JSON.stringify(init.body)}`)
    try {
      const status = Number(await run(args, config.join('\n') + '\n', init.signal || AbortSignal.timeout(90000)))
      if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error('Invalid Koalablog HTTP status')
      if ((await fs.stat(file)).size > 16 * 1024 * 1024) throw new Error('Koalablog response exceeds 16 MiB')
      const bytes = await fs.readFile(file)
      return new Response([204, 205, 304].includes(status) ? null : bytes, { status })
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  }
}
