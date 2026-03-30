import * as cheerio from 'cheerio'
import type { BEStation, FuelType } from './types.js'
import { FUEL_LABELS, RADIUS_CODES } from './types.js'

const BASE_URL = process.env.CARBU_BASE_URL || 'https://carbu.com/belgique'
const FETCH_TIMEOUT = 8000

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'fr-BE,fr;q=0.9',
  'Referer': 'https://carbu.com/belgique/',
}

function buildUrl(fuel: FuelType, town: string, postal: string, radius: number): string {
  const fuelLabel = FUEL_LABELS[fuel]
  const radiusCode = RADIUS_CODES[radius] || RADIUS_CODES[10]
  return `${BASE_URL}/index.php/liste-stations-service/${fuelLabel}/${encodeURIComponent(town)}/${postal}/${radiusCode}`
}

/**
 * Scrape carbu.com station list page.
 *
 * HTML structure (observed 2026-03):
 * - Station rows are in a table or repeated div blocks
 * - Each row contains: station name, brand, address, price, last update
 * - Selectors may change — keep this function focused and easy to update
 */
export async function scrapeStations(
  fuel: FuelType,
  town: string,
  postal: string,
  radius: number,
): Promise<BEStation[]> {
  const url = buildUrl(fuel, town, postal, radius)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

  let html: string
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`carbu.com responded with ${res.status}`)
    }
    html = await res.text()
  } finally {
    clearTimeout(timeout)
  }

  return parseStationsHtml(html, fuel, postal)
}

export function parseStationsHtml(html: string, fuel: FuelType, postal: string): BEStation[] {
  const $ = cheerio.load(html)
  const stations: BEStation[] = []

  // carbu.com uses .station-content blocks for each station entry
  // Each block contains the station info in structured divs
  // TODO: Verify selectors against live HTML — they may evolve
  $('.station-content, tr[data-station-id]').each((i, el) => {
    const $el = $(el)

    const stationId = $el.attr('data-station-id') || `BE_${postal}_${i}`
    const name = $el.find('.station-name, .name').first().text().trim()
    const brand = $el.find('.station-brand, .brand').first().text().trim()
    const address = $el.find('.station-address, .address').first().text().trim()
    const city = $el.find('.station-city, .city').first().text().trim() || ''
    const priceText = $el.find('.station-price, .price').first().text().trim()
    const dateText = $el.find('.station-date, .date-update').first().text().trim()

    const latStr = $el.attr('data-lat') || $el.find('[data-lat]').attr('data-lat')
    const lngStr = $el.attr('data-lng') || $el.find('[data-lng]').attr('data-lng')

    const price = parsePrice(priceText)
    const prices = {
      diesel: null as number | null,
      sp95: null as number | null,
      sp98: null as number | null,
      lpg: null as number | null,
      e85: null as number | null,
    }
    if (price !== null) {
      prices[fuel] = price
    }

    stations.push({
      id: stationId,
      name: name || `Station ${i + 1}`,
      brand: brand || '',
      address,
      city,
      postalCode: postal,
      country: 'BE',
      lat: latStr ? parseFloat(latStr) : null,
      lng: lngStr ? parseFloat(lngStr) : null,
      prices,
      updatedAt: parseDateText(dateText),
    })
  })

  return stations
}

function parsePrice(text: string): number | null {
  // Prices on carbu.com are like "1.789 €/l" or "1,789"
  const cleaned = text.replace(',', '.').replace(/[^\d.]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function parseDateText(text: string): string {
  // Try to extract a date from text like "Mis à jour le 30/03/2026"
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`
  }
  return new Date().toISOString()
}
