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
    const stations = parseStationsHtml(fixtureHtml, 'diesel', '6001')

    expect(stations).toHaveLength(3)
    expect(stations[0]).toMatchObject({
      id: '2088',
      name: 'Shell Express Marcinelle',
      brand: 'Shell Express',
      address: 'Avenue Eugene Mascaux 875',
      city: 'Marcinelle',
      postalCode: '6001',
      country: 'BE',
      lat: 50.380159434711,
      lng: 4.4255108607827,
    })
    expect(stations[0].prices.diesel).toBe(2.159)
  })

  it('extracts coordinates from data attributes', () => {
    const stations = parseStationsHtml(fixtureHtml, 'diesel', '6001')

    expect(stations[0].lat).toBe(50.380159434711)
    expect(stations[0].lng).toBe(4.4255108607827)
    expect(stations[2].lat).toBeNull()
    expect(stations[2].lng).toBeNull()
  })

  it('handles missing/invalid prices gracefully', () => {
    const stations = parseStationsHtml(fixtureHtml, 'diesel', '6001')

    expect(stations[2].prices.diesel).toBeNull()
  })

  it('parses date from 2-digit year format dd/mm/yy', () => {
    const stations = parseStationsHtml(fixtureHtml, 'diesel', '6001')

    expect(stations[0].updatedAt).toBe('2026-03-27T00:00:00.000Z')
    expect(stations[1].updatedAt).toBe('2026-03-26T00:00:00.000Z')
  })

  it('sets only the requested fuel type price', () => {
    const stations = parseStationsHtml(fixtureHtml, 'sp95', '6001')

    expect(stations[0].prices.sp95).toBe(2.159)
    expect(stations[0].prices.diesel).toBeNull()
  })

  it('parses address and city from data-address with <br/> separator', () => {
    const stations = parseStationsHtml(fixtureHtml, 'diesel', '6001')

    expect(stations[1].address).toBe('Rue de Beaumont 120')
    expect(stations[1].city).toBe('Marcinelle')
    expect(stations[1].postalCode).toBe('6001')
  })

  it('uses station postal code from data-address when available', () => {
    const stations = parseStationsHtml(fixtureHtml, 'diesel', '6001')

    // Third station is in Couillet (6010), different from query postal 6001
    expect(stations[2].postalCode).toBe('6010')
    expect(stations[2].city).toBe('Couillet')
  })
})
