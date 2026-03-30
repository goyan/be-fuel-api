import * as cheerio from 'cheerio'
import type { BEStation, FuelType } from './types.js'
import { FUEL_LABELS } from './types.js'
import { fetchWithTimeout } from './fetch.js'
import { getCached, setCached } from './cache.js'

const BASE_URL = process.env.CARBU_BASE_URL || 'https://carbu.com/belgique'
const LOCATION_API = 'https://carbu.com/commonFunctions/getlocation/controller.getlocation_JSON.php'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'fr-BE,fr;q=0.9',
  'Referer': 'https://carbu.com/belgique/',
}

/** Resolve a town name to a carbu.com location code (BE_ht_XXXX) */
async function resolveLocationCode(town: string): Promise<string> {
  const cacheKey = `loc_${town}`
  const cached = getCached<string>(cacheKey)
  if (cached) return cached

  const params = new URLSearchParams({
    location: town,
    page_limit: '1',
    minLevel: '5',
    maxLevel: '6',
    SHRT: '1',
    GPSCoordRequired: 'true',
    country: 'BE',
    L: 'fr',
    callback: 'x',
  })

  const res = await fetchWithTimeout(`${LOCATION_API}?${params}`, {
    headers: { 'User-Agent': HEADERS['User-Agent'] },
  })
  if (!res.ok) {
    throw new Error(`carbu.com location API responded with ${res.status}`)
  }

  const text = await res.text()
  // Response is JSONP: x([{...}]);
  const json = text.replace(/^x\(/, '').replace(/\);?\s*$/, '')
  const results = JSON.parse(json) as Array<{ ac: string }>

  if (results.length === 0) {
    throw new Error(`No carbu.com location found for "${town}"`)
  }

  const code = results[0].ac
  setCached(cacheKey, code)
  return code
}

function buildUrl(fuel: FuelType, town: string, locationCode: string): string {
  const fuelLabel = FUEL_LABELS[fuel]
  return `${BASE_URL}/index.php/liste-stations-service/${fuelLabel}/${encodeURIComponent(town)}/0/${locationCode}`
}

export async function scrapeStations(
  fuel: FuelType,
  town: string,
  postal: string,
  _radius: number,
): Promise<BEStation[]> {
  const locationCode = await resolveLocationCode(town)
  const url = buildUrl(fuel, town, locationCode)

  const res = await fetchWithTimeout(url, { headers: HEADERS })
  if (!res.ok) {
    throw new Error(`carbu.com responded with ${res.status}`)
  }
  const html = await res.text()

  return parseStationsHtml(html, fuel, postal)
}

export function parseStationsHtml(html: string, fuel: FuelType, postal: string): BEStation[] {
  const $ = cheerio.load(html)
  const stations: BEStation[] = []

  $('.stationItem').each((i, el) => {
    const $el = $(el)

    const stationId = $el.attr('data-id') || `BE_${postal}_${i}`
    const name = $el.attr('data-name') || `Station ${i + 1}`
    const brand = $el.find('.station-logo img').attr('alt') || ''

    const rawAddress = $el.attr('data-address') || ''
    const addressParts = rawAddress.split(/<br\/>/i)
    const street = addressParts[0]?.trim() || ''
    const postalCity = addressParts[1]?.trim() || ''
    const postalCodeMatch = postalCity.match(/^(\d{4})\s*(.*)$/)
    const stationPostal = postalCodeMatch ? postalCodeMatch[1] : postal
    const city = postalCodeMatch ? postalCodeMatch[2].trim() : postalCity

    const latStr = $el.attr('data-lat') || ''
    const lngStr = $el.attr('data-lng') || ''

    const priceStr = $el.attr('data-price') || ''
    const price = priceStr ? parseFloat(priceStr) : null
    const prices = {
      diesel: null as number | null,
      sp95: null as number | null,
      sp98: null as number | null,
      lpg: null as number | null,
      e85: null as number | null,
    }
    if (price !== null && !isNaN(price)) {
      prices[fuel] = price
    }

    const dateText = $el.find('span').filter((_, span) => /\d{2}\/\d{2}\/\d{2}/.test($(span).text())).first().text().trim()

    stations.push({
      id: stationId,
      name,
      brand,
      address: street,
      city,
      postalCode: stationPostal,
      country: 'BE',
      lat: latStr ? parseFloat(latStr) || null : null,
      lng: lngStr ? parseFloat(lngStr) || null : null,
      prices,
      updatedAt: parseDateText(dateText),
    })
  })

  return stations
}

function parseDateText(text: string): string {
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{2,4})/)
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3]
    return `${year}-${match[2]}-${match[1]}T00:00:00.000Z`
  }
  return new Date().toISOString()
}
