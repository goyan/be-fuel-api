import Fastify from 'fastify'
import cors from '@fastify/cors'
import type { FuelType } from './types.js'
import { FUEL_LABELS, RADIUS_CODES } from './types.js'
import { scrapeStations } from './scraper.js'
import { getCached, setCached, buildCacheKey } from './cache.js'
import { fetchOfficialPrices } from './official.js'
import type { BEStation } from './types.js'

const port = parseInt(process.env.PORT || '3001', 10)
const logLevel = process.env.LOG_LEVEL || 'info'

const app = Fastify({ logger: { level: logLevel } })

await app.register(cors, {
  origin: [
    'https://gasprice.vercel.app',
    'http://localhost:5173',
    /https:\/\/.*\.vercel\.app$/,
  ],
})

const VALID_FUELS = new Set(Object.keys(FUEL_LABELS))
const VALID_RADII = new Set(Object.keys(RADIUS_CODES).map(Number))

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
  const cached = getCached<BEStation[]>(cacheKey)
  if (cached) {
    return {
      country: 'BE',
      fuelType: fuel,
      postalCode: postal,
      town,
      count: cached.length,
      fetchedAt: new Date().toISOString(),
      stations: cached,
    }
  }

  try {
    const stations = await scrapeStations(fuel as FuelType, town.toUpperCase(), postal, radius)
    setCached(cacheKey, stations)

    return {
      country: 'BE',
      fuelType: fuel,
      postalCode: postal,
      town,
      count: stations.length,
      fetchedAt: new Date().toISOString(),
      stations,
    }
  } catch (err) {
    request.log.error(err, 'Failed to scrape carbu.com')
    return reply.status(503).send({ error: 'Unable to fetch station data. carbu.com may be unavailable.' })
  }
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
