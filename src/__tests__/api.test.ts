import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import type { BEStation, FuelType } from '../types.js'

// Mock scraper before importing routes
vi.mock('../scraper.js', () => ({
  scrapeStations: vi.fn(),
}))

vi.mock('../official.js', () => ({
  fetchOfficialPrices: vi.fn(),
}))

import { scrapeStations } from '../scraper.js'
import { fetchOfficialPrices } from '../official.js'

function buildApp() {
  const app = Fastify()

  app.get('/health', async () => ({ status: 'ok', uptime: 0 }))

  app.get<{
    Querystring: { fuel?: string; postal?: string; town?: string; radius?: string }
  }>('/stations', async (request, reply) => {
    const { fuel, postal, town, radius: radiusStr } = request.query

    if (!fuel || !postal || !town) {
      return reply.status(400).send({ error: 'Missing required params: fuel, postal, town' })
    }

    if (!['diesel', 'sp95', 'sp98', 'lpg', 'e85'].includes(fuel)) {
      return reply.status(400).send({ error: `Invalid fuel type: ${fuel}` })
    }

    if (!/^\d{4}$/.test(postal)) {
      return reply.status(400).send({ error: 'Invalid postal code' })
    }

    const radius = radiusStr ? parseInt(radiusStr, 10) : 10
    const stations = await scrapeStations(fuel as FuelType, town.toUpperCase(), postal, radius)

    return {
      country: 'BE',
      fuelType: fuel,
      postalCode: postal,
      town,
      count: stations.length,
      fetchedAt: new Date().toISOString(),
      stations,
    }
  })

  app.get('/official', async (request, reply) => {
    try {
      return await fetchOfficialPrices()
    } catch {
      return reply.status(503).send({ error: 'Unable to fetch official prices.' })
    }
  })

  return app
}

describe('API routes', () => {
  const app = buildApp()

  afterAll(async () => {
    await app.close()
  })

  describe('GET /health', () => {
    it('returns ok', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ status: 'ok' })
    })
  })

  describe('GET /stations', () => {
    it('returns 400 if fuel is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/stations?postal=7700&town=MOUSCRON' })
      expect(res.statusCode).toBe(400)
    })

    it('returns 400 if postal is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/stations?fuel=diesel&town=MOUSCRON' })
      expect(res.statusCode).toBe(400)
    })

    it('returns 400 for invalid fuel type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/stations?fuel=hydrogen&postal=7700&town=MOUSCRON',
      })
      expect(res.statusCode).toBe(400)
    })

    it('returns 400 for invalid postal code', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/stations?fuel=diesel&postal=ABC&town=MOUSCRON',
      })
      expect(res.statusCode).toBe(400)
    })

    it('returns stations on valid request', async () => {
      const mockStations: BEStation[] = [
        {
          id: 'BE_21457',
          name: 'Total Mouscron',
          brand: 'Total',
          address: 'Rue de Namur 12',
          city: 'Mouscron',
          postalCode: '7700',
          country: 'BE',
          lat: 50.7453,
          lng: 3.2097,
          prices: { diesel: 1.789, sp95: null, sp98: null, lpg: null, e85: null },
          updatedAt: '2026-03-30T00:00:00.000Z',
        },
      ]

      vi.mocked(scrapeStations).mockResolvedValueOnce(mockStations)

      const res = await app.inject({
        method: 'GET',
        url: '/stations?fuel=diesel&postal=7700&town=MOUSCRON',
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.country).toBe('BE')
      expect(body.fuelType).toBe('diesel')
      expect(body.count).toBe(1)
      expect(body.stations[0].name).toBe('Total Mouscron')
    })

    it('returns empty array when no stations found', async () => {
      vi.mocked(scrapeStations).mockResolvedValueOnce([])

      const res = await app.inject({
        method: 'GET',
        url: '/stations?fuel=diesel&postal=1000&town=BRUXELLES',
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().count).toBe(0)
      expect(res.json().stations).toEqual([])
    })
  })

  describe('GET /official', () => {
    it('returns official prices', async () => {
      vi.mocked(fetchOfficialPrices).mockResolvedValueOnce({
        date: '2026-03-30',
        source: 'statbel.fgov.be',
        prices: { diesel: 1.923, sp95_e10: 1.677, sp98_e5: 1.684, lpg: 0.871 },
      })

      const res = await app.inject({ method: 'GET', url: '/official' })
      expect(res.statusCode).toBe(200)
      expect(res.json().prices.diesel).toBe(1.923)
    })
  })
})
