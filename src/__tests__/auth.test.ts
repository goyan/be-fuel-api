import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'

const API_KEY = 'test-secret'

function buildApp() {
  const app = Fastify()

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/health')) return
    if (API_KEY && request.headers['x-api-key'] !== API_KEY) {
      return reply.status(401).send({ error: 'Invalid or missing API key' })
    }
  })

  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/stations', async () => ({ stations: [] }))
  app.get('/stations/geo', async () => ({ results: [] }))
  app.get('/official', async () => ({ prices: {} }))

  return app
}

describe('Auth hook (x-api-key)', () => {
  const app = buildApp()

  it('GET /health without header → 200 (exempt)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
  })

  it('GET /stations without header → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/stations' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toMatch(/API key/)
  })

  it('GET /stations with wrong key → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/stations',
      headers: { 'x-api-key': 'wrong-key' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('GET /stations with correct key → not 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/stations',
      headers: { 'x-api-key': API_KEY },
    })
    expect(res.statusCode).not.toBe(401)
  })

  it('GET /stations/geo without header → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/stations/geo' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /official without header → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/official' })
    expect(res.statusCode).toBe(401)
  })
})
