import { describe, expect, it } from 'vitest'
import config from '../../playwright.config'
import { readFileSync } from 'node:fs'

describe('isolated browser gate loopback configuration', () => {
  it('uses one explicit IPv4 origin for Vite, browser navigation and readiness', () => {
    const servers = Array.isArray(config.webServer) ? config.webServer : []
    expect(config.use?.baseURL).toBe('http://127.0.0.1:5273')
    expect(servers).toHaveLength(2)
    expect(servers[1].command).toBe('npx vite --host 127.0.0.1 --port 5273 --strictPort')
    expect(servers[1].url).toBe(config.use?.baseURL)
    expect(servers[0].url).toBe('http://127.0.0.1:5274/api/ai/status')
    for (const server of servers) {
      expect(server.port).toBeUndefined()
      expect(server.reuseExistingServer).toBe(false)
    }
  })

  it('keeps the API proxy and test data isolated without changing production binding', () => {
    const servers = Array.isArray(config.webServer) ? config.webServer : []
    expect(servers[0].env).toMatchObject({ API_PORT: '5274', DATA_DIR: 'data-e2e' })
    expect(servers[1].env).toMatchObject({ API_PORT: '5274', VITE_CACHE_DIR: 'node_modules/.vite-e2e' })
    const viteSource = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
    expect(viteSource).toContain('const API = `http://127.0.0.1:${process.env.API_PORT ?? 5174}`')
    expect(viteSource).toContain("proxy: { '/api': API, '/media': API }")
    expect(config.retries ?? 0).toBe(0)
    expect(config.timeout).toBe(90_000)
  })
})
