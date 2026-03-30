import { describe, it, expect, vi, afterAll } from 'vitest'
import Fastify from 'fastify'
import type { BEStation, FuelType, GasPriceFuelType } from '../types.js'
import { FUEL_LABELS, GP_TO_BE_FUEL, BELGIAN_BOUNDS, VALID_GP_FUELS, VALID_RADII } from '../types.js'
import { mapToGasPriceStation } from '../mapper.js'

vi.mock('../scraper.js', () => ({
  scrapeStations: vi.fn(),
}))

vi.mock('../official.js', () => ({
  fetchOfficialPrices: vi.fn(),
}))

vi.mock('../geocode.js', () => ({
  reverseGeocode: vi.fn(),
}))

import { scrapeStations } from '../scraper.js'
import { fetchOfficialPrices } from '../official.js'
import { reverseGeocode } from '../geocode.js'

const VALID_FUELS = new Set(Object.keys(FUEL_LABELS))
const { lat: latBounds, lng: lngBounds } = BELGIAN_BOUNDS

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

    if (!VALID_FUELS.has(fuel)) {
      return reply.status(400).send({ error: `Invalid fuel type: ${fuel}` })
    }

    if (!/^\d{4}$/.test(postal)) {
      return reply.status(400).send({ error: 'Invalid postal code' })
    }

    const radius = radiusStr ? parseInt(radiusStr, 10) : 10
    if (!VALID_RADII.has(radius)) {
      return reply.status(400).send({ error: `Invalid radius: ${radius}` })
    }

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

  app.get<{
    Querystring: { lat?: string; lng?: string; radius?: string; fuels?: string }
  }>('/stations/geo', async (request, reply) => {
    const { lat: latStr, lng: lngStr, radius: radiusStr, fuels: fuelsStr } = request.query

    if (!latStr) {
      return reply.status(400).send({ error: 'Missing required param: lat' })
    }
    if (!lngStr) {
      return reply.status(400).send({ error: 'Missing required param: lng' })
    }

    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)

    if (isNaN(lat) || isNaN(lng)) {
      return reply.status(400).send({ error: 'lat and lng must be valid numbers' })
    }
    if (lat < latBounds.min || lat > latBounds.max || lng < lngBounds.min || lng > lngBounds.max) {
      return reply.status(400).send({ error: 'Coordinates out of Belgian range.' })
    }

    const radius = radiusStr ? parseInt(radiusStr, 10) : 10
    if (!VALID_RADII.has(radius)) {
      return reply.status(400).send({ error: `Invalid radius: ${radius}` })
    }

    const rawFuels = fuelsStr ? fuelsStr.split(',').map(f => f.trim()) : ['gazole']
    const gpFuels = rawFuels.filter(f => VALID_GP_FUELS.has(f as GasPriceFuelType)) as GasPriceFuelType[]
    if (gpFuels.length === 0) {
      return reply.status(400).send({ error: 'No valid fuel types.' })
    }

    const beFuels = [...new Set(gpFuels.map(f => GP_TO_BE_FUEL[f]))]

    const geo = await reverseGeocode(lat, lng)
    const { postalCode, town } = geo

    const stationMap = new Map<string, BEStation>()

    await Promise.all(
      beFuels.map(async (fuel) => {
        const stations = await scrapeStations(fuel as FuelType, town.toUpperCase(), postalCode, radius)
        for (const station of stations) {
          const existing = stationMap.get(station.id)
          if (existing) {
            existing.prices = {
              diesel: existing.prices.diesel ?? station.prices.diesel,
              sp95: existing.prices.sp95 ?? station.prices.sp95,
              sp98: existing.prices.sp98 ?? station.prices.sp98,
              lpg: existing.prices.lpg ?? station.prices.lpg,
              e85: existing.prices.e85 ?? station.prices.e85,
            }
          } else {
            stationMap.set(station.id, { ...station })
          }
        }
      }),
    )

    const gpStations = [...stationMap.values()].map(mapToGasPriceStation)
    return { results: gpStations }
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

  describe('GET /stations/geo', () => {
    it('returns 400 if lat is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/stations/geo?lng=4.35' })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toMatch(/lat/)
    })

    it('returns 400 if lng is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/stations/geo?lat=50.85' })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toMatch(/lng/)
    })

    it('returns 400 if lat is out of Belgian range', async () => {
      const res = await app.inject({ method: 'GET', url: '/stations/geo?lat=48.0&lng=4.35' })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toMatch(/range/)
    })

    it('returns 400 if lng is out of Belgian range', async () => {
      const res = await app.inject({ method: 'GET', url: '/stations/geo?lat=50.85&lng=1.0' })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toMatch(/range/)
    })

    it('returns 200 with GasPriceStation format on valid request', async () => {
      const mockStation: BEStation = {
        id: 'BE_99001',
        name: 'Shell Bruxelles',
        brand: 'Shell',
        address: 'Rue du Midi 5',
        city: 'Bruxelles',
        postalCode: '1000',
        country: 'BE',
        lat: 50.85,
        lng: 4.35,
        prices: { diesel: 1.799, sp95: 1.699, sp98: 1.759, lpg: null, e85: null },
        updatedAt: '2026-03-30T00:00:00.000Z',
      }

      vi.mocked(reverseGeocode).mockResolvedValue({ postalCode: '1000', town: 'Bruxelles' })
      vi.mocked(scrapeStations).mockResolvedValue([mockStation])

      const res = await app.inject({
        method: 'GET',
        url: '/stations/geo?lat=50.85&lng=4.35&fuels=gazole,e10',
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('results')
      expect(Array.isArray(body.results)).toBe(true)
      expect(body.results.length).toBeGreaterThan(0)

      const station = body.results[0]
      expect(station).toHaveProperty('id', 'BE_99001')
      expect(station).toHaveProperty('adresse', 'Rue du Midi 5')
      expect(station).toHaveProperty('ville', 'Bruxelles')
      expect(station).toHaveProperty('cp', '1000')
      expect(station).toHaveProperty('latitude', 50.85)
      expect(station).toHaveProperty('longitude', 4.35)
      expect(station.geom).toEqual({ lon: 4.35, lat: 50.85 })
      expect(station).toHaveProperty('gazole_prix', 1.799)
      expect(station).toHaveProperty('e10_prix', 1.699)
      expect(station).toHaveProperty('sp95_prix', 1.699)
      expect(station).toHaveProperty('services_service')
      expect(Array.isArray(station.services_service)).toBe(true)
      expect(station).toHaveProperty('carburants_disponibles')
      expect(Array.isArray(station.carburants_disponibles)).toBe(true)
    })

    it('deduplicates stations when same id returned by multiple fuel queries', async () => {
      const dieselStation: BEStation = {
        id: 'BE_99002',
        name: 'Total Test',
        brand: 'Total',
        address: 'Rue Test 1',
        city: 'Liège',
        postalCode: '4000',
        country: 'BE',
        lat: 50.64,
        lng: 5.57,
        prices: { diesel: 1.75, sp95: null, sp98: null, lpg: null, e85: null },
        updatedAt: '2026-03-30T00:00:00.000Z',
      }
      const sp95Station: BEStation = {
        ...dieselStation,
        prices: { diesel: null, sp95: 1.65, sp98: null, lpg: null, e85: null },
      }

      vi.mocked(reverseGeocode).mockResolvedValue({ postalCode: '4000', town: 'Liège' })
      vi.mocked(scrapeStations)
        .mockResolvedValueOnce([dieselStation])
        .mockResolvedValueOnce([sp95Station])

      const res = await app.inject({
        method: 'GET',
        url: '/stations/geo?lat=50.64&lng=5.57&fuels=gazole,e10',
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.results).toHaveLength(1)
      expect(body.results[0].gazole_prix).toBe(1.75)
      expect(body.results[0].e10_prix).toBe(1.65)
    })

    it('returns empty results when no stations found', async () => {
      vi.mocked(reverseGeocode).mockResolvedValue({ postalCode: '9999', town: 'Unknown' })
      vi.mocked(scrapeStations).mockResolvedValue([])

      const res = await app.inject({
        method: 'GET',
        url: '/stations/geo?lat=50.5&lng=4.0',
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().results).toEqual([])
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
