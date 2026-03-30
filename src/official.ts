import type { OfficialPrices } from './types.js'
import { getCached, setCached } from './cache.js'

const STATBEL_VIEW_ID = process.env.STATBEL_VIEW_ID || '9e9cf394-6c54-4d81-8013-7124a8c4bf15'
const STATBEL_URL = `https://bestat.statbel.fgov.be/bestat/api/views/${STATBEL_VIEW_ID}/result/JSON`
const CACHE_KEY = 'BE_official_prices'

export async function fetchOfficialPrices(): Promise<OfficialPrices> {
  const cached = getCached<OfficialPrices>(CACHE_KEY)
  if (cached) return cached

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch(STATBEL_URL, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`Statbel API responded with ${res.status}`)
    }

    const data = await res.json()
    const prices = parseStatbelResponse(data)
    setCached(CACHE_KEY, prices)
    return prices
  } finally {
    clearTimeout(timeout)
  }
}

function parseStatbelResponse(data: unknown): OfficialPrices {
  // Statbel returns structured JSON with fuel price records
  // The exact structure depends on the view — adapt parsing as needed
  const records = Array.isArray(data) ? data : []
  const latest = records[records.length - 1] || {}

  return {
    date: new Date().toISOString().split('T')[0],
    source: 'statbel.fgov.be',
    prices: {
      diesel: extractPrice(latest, 'diesel', 'Diesel'),
      sp95_e10: extractPrice(latest, 'sp95', 'E10', '95'),
      sp98_e5: extractPrice(latest, 'sp98', 'E5', '98'),
      lpg: extractPrice(latest, 'lpg', 'LPG'),
    },
  }
}

function extractPrice(record: Record<string, unknown>, ...keywords: string[]): number | null {
  for (const [key, value] of Object.entries(record)) {
    const keyLower = key.toLowerCase()
    if (keywords.some(kw => keyLower.includes(kw.toLowerCase()))) {
      const num = typeof value === 'number' ? value : parseFloat(String(value))
      if (!isNaN(num)) return num
    }
  }
  return null
}
