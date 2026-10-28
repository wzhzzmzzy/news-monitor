import { createServer, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { collectSource, classifyCollectionFailure } from './collect.js'
import { parseFeedConfig } from './config.js'

const feed = '<rss version="2.0"><channel><title>Test</title><item><title>Recovered</title><link>https://news.example/article</link></item></channel></rss>'
const servers: Server[] = []
const sockets = new Set<Socket>()
const track = (socket: Socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) }
async function listen(server: Server) {
  servers.push(server)
  server.on('connection', track)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}
function config(url: string, collection = {}) {
  return parseFeedConfig({ sources: [{ id: 'rss', name: 'RSS', type: 'rss', url }], collection: { rssRetries: 0, rssTimeoutMs: 500, retryDelayMs: 0, ...collection } })
}
const collect = (cfg: ReturnType<typeof config>) => collectSource(cfg.sources[0], cfg, '2026-10-28T04:00:00Z')
async function proxyTo(port: number) {
  const targets: string[] = []
  const proxy = createServer()
  proxy.on('connect', (request, client, head) => {
    targets.push(request.url!)
    const upstream = connect(port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      client.pipe(upstream).pipe(client)
    })
    track(upstream)
    upstream.on('error', () => client.destroy())
    client.on('error', () => upstream.destroy())
    client.on('close', () => upstream.destroy())
  })
  return { url: `http://127.0.0.1:${await listen(proxy)}`, targets }
}
beforeEach(() => {
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy']) vi.stubEnv(key, undefined)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const socket of sockets) socket.destroy()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

it.each(['environment', 'configuration'])('collects a feed only reachable through the %s proxy', async mode => {
  const publisher = await listen(createServer((_req, res) => res.end(feed)))
  const proxy = await proxyTo(publisher)
  if (mode === 'environment') vi.stubEnv('HTTP_PROXY', proxy.url)
  const cfg = config('http://unreachable.invalid/feed', mode === 'configuration' ? { rssProxyUrl: proxy.url } : {})
  const items = await collect(cfg)
  expect(items.map(item => item.title)).toEqual(['Recovered'])
  expect(proxy.targets).toEqual(['unreachable.invalid:80'])
})

it('honors NO_PROXY for direct local feeds even with an explicit proxy', async () => {
  const publisher = await listen(createServer((_req, res) => res.end(feed)))
  const proxy = await proxyTo(publisher)
  vi.stubEnv('NO_PROXY', '127.0.0.1')
  expect(await collect(config(`http://127.0.0.1:${publisher}/feed`, { rssProxyUrl: proxy.url }))).toHaveLength(1)
  expect(proxy.targets).toEqual([])
})

it('retries a timeout during the body read, then parses the complete response', async () => {
  let attempts = 0
  const port = await listen(createServer((_req, res) => {
    attempts++
    if (attempts === 1) { res.writeHead(200); res.write('<rss>'); return }
    res.end(feed)
  }))
  const items = await collect(config(`http://127.0.0.1:${port}/feed`, { rssTimeoutMs: 100, rssRetries: 1 }))
  expect(items).toHaveLength(1)
  expect(attempts).toBe(2)
})

it('bounds repeated body timeouts by rssRetries and retains the safe timeout category', async () => {
  let attempts = 0
  const port = await listen(createServer((_req, res) => { attempts++; res.writeHead(200); res.write('<rss>') }))
  const error = await collect(config(`http://127.0.0.1:${port}/feed`, { rssTimeoutMs: 100, rssRetries: 1 })).catch(e => e)
  expect(classifyCollectionFailure(error, true)).toEqual({ code: 'rss_timeout' })
  expect(attempts).toBe(2)
})

it.each([403, 429])('does not retry HTTP %i', async status => {
  let attempts = 0
  const port = await listen(createServer((_req, res) => { attempts++; res.writeHead(status); res.end('unavailable') }))
  const error = await collect(config(`http://127.0.0.1:${port}/feed`, { rssRetries: 2 })).catch(e => e)
  expect(classifyCollectionFailure(error, true)).toEqual({ code: 'rss_http', httpStatus: status })
  expect(attempts).toBe(1)
})
