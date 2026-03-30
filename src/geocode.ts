import { fetchWithTimeout } from './fetch.js'
import { getCached, setCached } from './cache.js'

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'

interface NominatimResponse {
  address?: {
    postcode?: string
    city?: string
    town?: string
    village?: string
    municipality?: string
    country_code?: string
  }
}

export interface GeoLocation {
  postalCode: string
  town: string
}

/** Belgian border cities — fallback when coords are outside Belgium */
const BORDER_CITIES: GeoLocation[] = [
  { postalCode: '7700', town: 'Mouscron' },
  { postalCode: '7500', town: 'Tournai' },
  { postalCode: '7000', town: 'Mons' },
  { postalCode: '6000', town: 'Charleroi' },
  { postalCode: '5000', town: 'Namur' },
  { postalCode: '4000', town: 'Liège' },
  { postalCode: '4700', town: 'Eupen' },
  { postalCode: '6700', town: 'Arlon' },
  { postalCode: '6600', town: 'Bastogne' },
  { postalCode: '8900', town: 'Ieper' },
  { postalCode: '8500', town: 'Kortrijk' },
  { postalCode: '9000', town: 'Gent' },
  { postalCode: '2000', town: 'Antwerpen' },
  { postalCode: '3500', town: 'Hasselt' },
]

const BORDER_COORDS: Array<{ lat: number; lng: number }> = [
  { lat: 50.74, lng: 3.22 },   // Mouscron
  { lat: 50.61, lng: 3.39 },   // Tournai
  { lat: 50.45, lng: 3.95 },   // Mons
  { lat: 50.41, lng: 4.44 },   // Charleroi
  { lat: 50.47, lng: 4.87 },   // Namur
  { lat: 50.63, lng: 5.57 },   // Liège
  { lat: 50.63, lng: 6.04 },   // Eupen
  { lat: 49.68, lng: 5.82 },   // Arlon
  { lat: 50.00, lng: 5.72 },   // Bastogne
  { lat: 50.85, lng: 2.89 },   // Ieper
  { lat: 50.83, lng: 3.26 },   // Kortrijk
  { lat: 51.05, lng: 3.72 },   // Gent
  { lat: 51.22, lng: 4.40 },   // Antwerpen
  { lat: 50.93, lng: 5.34 },   // Hasselt
]

function findNearestBorderCity(lat: number, lng: number): GeoLocation {
  let minDist = Infinity
  let nearest = BORDER_CITIES[0]
  for (let i = 0; i < BORDER_COORDS.length; i++) {
    const dLat = lat - BORDER_COORDS[i].lat
    const dLng = lng - BORDER_COORDS[i].lng
    const dist = dLat * dLat + dLng * dLng
    if (dist < minDist) {
      minDist = dist
      nearest = BORDER_CITIES[i]
    }
  }
  return nearest
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeoLocation> {
  const cacheKey = `geo_${lat.toFixed(4)}_${lng.toFixed(4)}`
  const cached = getCached<GeoLocation>(cacheKey)
  if (cached) return cached

  const url = `${NOMINATIM_URL}?lat=${lat}&lon=${lng}&format=json&addressdetails=1`

  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'be-fuel-api/1.0 (https://github.com/be-fuel-api)',
      'Accept': 'application/json',
    },
  })
  if (!res.ok) {
    throw new Error(`Nominatim responded with ${res.status}`)
  }
  const data = await res.json() as NominatimResponse

  const address = data.address ?? {}
  const countryCode = address.country_code ?? ''
  const postalCode = address.postcode ?? ''
  const town = address.city ?? address.town ?? address.village ?? address.municipality ?? ''

  let result: GeoLocation

  if (countryCode === 'be' && postalCode) {
    result = { postalCode, town }
  } else {
    // Outside Belgium — find nearest Belgian border city
    result = findNearestBorderCity(lat, lng)
  }

  setCached(cacheKey, result)
  return result
}
