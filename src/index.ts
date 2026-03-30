import 'dotenv/config'
import { timingSafeEqual } from 'crypto'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import type { FuelType, GasPriceFuelType, GasPriceStation } from './types.js'
import { FUEL_LABELS, GP_TO_BE_FUEL, BELGIAN_BOUNDS, VALID_GP_FUELS, VALID_RADII } from './types.js'

import { haversine } from './geo-utils.js'
import { scrapeStations } from './scraper.js'
import { getCached, setCached, buildCacheKey } from './cache.js'
import { fetchOfficialPrices } from './official.js'
import type { BEStation } from './types.js'
import { reverseGeocode } from './geocode.js'
import { mapToGasPriceStation } from './mapper.js'

const port = parseInt(process.env.PORT || '3001', 10)
const logLevel = process.env.LOG_LEVEL || 'info'

const app = Fastify({ logger: { level: logLevel } })

await app.register(rateLimit, { max: 60, timeWindow: '1 minute' })

await app.register(cors, {
  origin: [
    'https://gasprice.vercel.app',
    'http://localhost:5173',
    /https:\/\/.*\.vercel\.app$/,
  ],
})

const VALID_FUELS = new Set(Object.keys(FUEL_LABELS))
const ALL_FUEL_KEYS = Object.keys(FUEL_LABELS) as FuelType[]
const { lat: latBounds, lng: lngBounds } = BELGIAN_BOUNDS

const API_KEY = process.env.API_KEY || ''

interface CachedStations {
  stations: BEStation[]
  fetchedAt: string
}

// --- Auth hook (all routes except /health) ---

app.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/health')) return
  if (!API_KEY) return

  const key = request.headers['x-api-key']
  if (typeof key !== 'string' || key.length !== API_KEY.length ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(API_KEY))) {
    return reply.status(401).send({ error: 'Invalid or missing API key' })
  }
})

// --- Routes ---

app.get('/health', async () => {
  return { status: 'ok', uptime: Math.floor(process.uptime()) }
})

app.get<{
  Querystring: { fuel?: string; postal?: string; town?: string; radius?: string }
}>('/stations', async (request, reply) => {
  const { fuel, postal, town, radius: radiusStr } = request.query

  if (!fuel || !postal || !town) {
    return reply.status(400).send({ error: 'Missing required params: fuel, postal, town' })
  }

  if (town.length > 100) {
    return reply.status(400).send({ error: 'Town name too long (max 100 chars)' })
  }

  if (!VALID_FUELS.has(fuel)) {
    return reply.status(400).send({
      error: `Invalid fuel type: ${fuel}. Valid: ${[...VALID_FUELS].join(', ')}`,
    })
  }

  if (!/^\d{4}$/.test(postal)) {
    return reply.status(400).send({ error: 'Invalid postal code. Must be 4 digits.' })
  }

  const radius = radiusStr ? parseInt(radiusStr, 10) : 10
  if (!VALID_RADII.has(radius)) {
    return reply.status(400).send({
      error: `Invalid radius: ${radius}. Valid: ${[...VALID_RADII].join(', ')}`,
    })
  }

  const cacheKey = buildCacheKey(fuel, postal, town, radius)
  const cached = getCached<CachedStations>(cacheKey)
  if (cached) {
    return {
      country: 'BE',
      fuelType: fuel,
      postalCode: postal,
      town,
      count: cached.stations.length,
      fetchedAt: cached.fetchedAt,
      stations: cached.stations,
    }
  }

  try {
    const stations = await scrapeStations(fuel as FuelType, town.toUpperCase(), postal, radius)
    const fetchedAt = new Date().toISOString()
    setCached(cacheKey, { stations, fetchedAt })

    return {
      country: 'BE',
      fuelType: fuel,
      postalCode: postal,
      town,
      count: stations.length,
      fetchedAt,
      stations,
    }
  } catch (err) {
    request.log.error(err, 'Failed to scrape carbu.com')
    return reply.status(503).send({ error: 'Unable to fetch station data. carbu.com may be unavailable.' })
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
    return reply.status(400).send({
      error: `Coordinates out of Belgian range. lat: ${latBounds.min}-${latBounds.max}, lng: ${lngBounds.min}-${lngBounds.max}`,
    })
  }

  const radius = radiusStr ? parseInt(radiusStr, 10) : 10
  if (!VALID_RADII.has(radius)) {
    return reply.status(400).send({
      error: `Invalid radius: ${radius}. Valid: ${[...VALID_RADII].join(', ')}`,
    })
  }

  const rawFuels = fuelsStr ? fuelsStr.split(',').map(f => f.trim()) : ['gazole']
  const gpFuels = rawFuels.filter(f => VALID_GP_FUELS.has(f as GasPriceFuelType)) as GasPriceFuelType[]
  if (gpFuels.length === 0) {
    return reply.status(400).send({
      error: `No valid fuel types. Valid: ${[...VALID_GP_FUELS].join(', ')}`,
    })
  }

  const beFuels = [...new Set(gpFuels.map(f => GP_TO_BE_FUEL[f]))]

  const geoCacheKey = `geo_${lat.toFixed(4)}_${lng.toFixed(4)}_${radius}_${beFuels.sort().join(',')}`
  const geoCached = getCached<GasPriceStation[]>(geoCacheKey)
  if (geoCached) {
    return { results: geoCached }
  }

  let postalCode: string
  let town: string
  try {
    const geo = await reverseGeocode(lat, lng)
    postalCode = geo.postalCode
    town = geo.town
    request.log.info({ postalCode, town, lat, lng }, 'Geocode result')
  } catch (err) {
    request.log.error(err, 'Reverse geocode failed')
    return reply.status(502).send({ error: 'Unable to resolve location from coordinates.' })
  }

  const stationMap = new Map<string, BEStation>()

  await Promise.all(
    beFuels.map(async (fuel) => {
      try {
        const stations = await scrapeStations(fuel as FuelType, town.toUpperCase(), postalCode, radius)
        request.log.info({ fuel, stationCount: stations.length }, 'Scraped stations')
        for (const station of stations) {
          const existing = stationMap.get(station.id)
          if (existing) {
            const ep = existing.pricesUpdatedAt ?? { diesel: null, sp95: null, sp98: null, lpg: null, e85: null, ev: null }
            for (const f of ALL_FUEL_KEYS) {
              if (station.prices[f] !== null) {
                existing.prices[f] = station.prices[f]
                ep[f] = station.updatedAt
              }
            }
            existing.pricesUpdatedAt = ep
          } else {
            const pua = { diesel: null, sp95: null, sp98: null, lpg: null, e85: null, ev: null } as Record<FuelType, string | null>
            for (const f of ALL_FUEL_KEYS) {
              if (station.prices[f] !== null) pua[f] = station.updatedAt
            }
            stationMap.set(station.id, { ...station, pricesUpdatedAt: pua })
          }
        }
      } catch (err) {
        request.log.warn(err, `Failed to scrape fuel type ${fuel}`)
      }
    }),
  )

  // Filter by exact haversine distance
  const allStations = [...stationMap.values()]
  const filtered = allStations.filter(s =>
    s.lat !== null && s.lng !== null && haversine(lat, lng, s.lat, s.lng) <= radius,
  )
  request.log.info({ total: allStations.length, filtered: filtered.length, radius, sampleDist: allStations[0] ? haversine(lat, lng, allStations[0].lat!, allStations[0].lng!) : null }, 'Haversine filter')

  const gpStations = filtered.map(mapToGasPriceStation)
  setCached(geoCacheKey, gpStations)

  return { results: gpStations }
})

app.get('/official', async (request, reply) => {
  try {
    return await fetchOfficialPrices()
  } catch (err) {
    request.log.error(err, 'Failed to fetch official prices')
    return reply.status(503).send({ error: 'Unable to fetch official prices.' })
  }
})

// --- Start ---

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (err) {
  app.log.fatal(err)
  process.exit(1)
}
