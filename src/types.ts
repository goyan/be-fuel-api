export interface BEStation {
  id: string
  name: string
  brand: string
  address: string
  city: string
  postalCode: string
  country: 'BE'
  lat: number | null
  lng: number | null
  prices: {
    diesel: number | null
    sp95: number | null
    sp98: number | null
    lpg: number | null
    e85: number | null
  }
  updatedAt: string
}

export interface StationsResponse {
  country: 'BE'
  fuelType: string
  postalCode: string
  town: string
  count: number
  fetchedAt: string
  stations: BEStation[]
}

export interface OfficialPrices {
  date: string
  source: string
  prices: {
    diesel: number | null
    sp95_e10: number | null
    sp98_e5: number | null
    lpg: number | null
  }
}

export type FuelType = 'diesel' | 'sp95' | 'sp98' | 'lpg' | 'e85'

export const FUEL_LABELS: Record<FuelType, string> = {
  diesel: 'Diesel%20(B7)',
  sp95: 'Super%2095%20(E10)',
  sp98: 'Super%2098%20(E5)',
  lpg: 'LPG',
  e85: 'Super%20E85',
}

export const RADIUS_CODES: Record<number, string> = {
  5: 'BE_ht_1578',
  10: 'BE_ht_1579',
  20: 'BE_ht_1580',
}
