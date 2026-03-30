import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseStationsHtml } from '../scraper.js'

const fixtureHtml = readFileSync(
  resolve(import.meta.dirname, '../__fixtures__/carbu-sample.html'),
  'utf-8',
)

describe('parseStationsHtml', () => {
  it('parses stations from HTML fixture', () => {
    const stations = parseStationsHtml(fixtureHtml, 'diesel', '7700')

    expect(stations).toHaveLength(3)
    expect(stations[0]).toMatchObject({
      id: 'BE_21457',
      name: 'Total Mouscron Centre',
      brand: 'Total',
      address: 'Rue de Namur 12',
      postalCode: '7700',
      country: 'BE',
      lat: 50.7453,
      lng: 3.2097,
    })
    expect(stations[0].prices.diesel).toBe(1.789)
  })

  it('extracts coordinates from data attributes', () => {
    const stations = parseStationsHtml(fixtureHtml, 'diesel', '7700')

    expect(stations[0].lat).toBe(50.7453)
    expect(stations[0].lng).toBe(3.2097)
    expect(stations[2].lat).toBeNull()
    expect(stations[2].lng).toBeNull()
  })

  it('handles missing/invalid prices gracefully', () => {
    const stations = parseStationsHtml(fixtureHtml, 'diesel', '7700')

    expect(stations[2].prices.diesel).toBeNull()
  })

  it('parses date from French format', () => {
    const stations = parseStationsHtml(fixtureHtml, 'diesel', '7700')

    expect(stations[0].updatedAt).toBe('2026-03-30T00:00:00.000Z')
    expect(stations[1].updatedAt).toBe('2026-03-29T00:00:00.000Z')
  })

  it('sets only the requested fuel type price', () => {
    const stations = parseStationsHtml(fixtureHtml, 'sp95', '7700')

    expect(stations[0].prices.sp95).toBe(1.789)
    expect(stations[0].prices.diesel).toBeNull()
  })
})
