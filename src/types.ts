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
    ev: number | null
  }
  updatedAt: string
  pricesUpdatedAt?: Record<FuelType, string | null>
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

export type FuelType = 'diesel' | 'sp95' | 'sp98' | 'lpg' | 'e85' | 'ev'

export type GasPriceFuelType = 'gazole' | 'sp95' | 'sp98' | 'e10' | 'e85' | 'gplc' | 'ev'

/** Map gasPrice fuel type → BE fuel type */
export const GP_TO_BE_FUEL: Record<GasPriceFuelType, FuelType> = {
  gazole: 'diesel',
  sp95: 'sp95',
  e10: 'sp95',
  sp98: 'sp98',
  gplc: 'lpg',
  e85: 'e85',
  ev: 'ev',
}

/** Map BE fuel type → gasPrice fuel type */
export const BE_TO_GP_FUEL: Record<FuelType, GasPriceFuelType> = {
  diesel: 'gazole',
  sp95: 'e10',
  sp98: 'sp98',
  lpg: 'gplc',
  e85: 'e85',
  ev: 'ev',
}

export interface GasPriceStation {
  id: string
  adresse: string
  ville: string
  cp: string
  latitude: number
  longitude: number
  geom: { lon: number; lat: number }
  gazole_prix: number | null
  gazole_maj: string | null
  sp95_prix: number | null
  sp95_maj: string | null
  sp98_prix: number | null
  sp98_maj: string | null
  e10_prix: number | null
  e10_maj: string | null
  e85_prix: number | null
  e85_maj: string | null
  gplc_prix: number | null
  gplc_maj: string | null
  ev_prix: number | null
  ev_maj: string | null
  carburants_disponibles: string[]
  services_service: string[]
  horaires_automate_24_24: string
}

// Extended bounds: Belgium + ~50km border buffer (FR/NL/DE/LU)
export const BELGIAN_BOUNDS = {
  lat: { min: 48.9, max: 52.1 },
  lng: { min: 1.8, max: 7.0 },
} as const

export const VALID_GP_FUELS = new Set<GasPriceFuelType>(['gazole', 'sp95', 'sp98', 'e10', 'e85', 'gplc', 'ev'])

export const FUEL_LABELS: Record<FuelType, string> = {
  diesel: 'Diesel%20(B7)',
  sp95: 'Super%2095%20(E10)',
  sp98: 'Super%2098%20(E5)',
  lpg: 'LPG',
  e85: 'Super%20E85',
  ev: 'Electrique',
}

/** Radii accepted by the API — carbu.com returns ~10km, we filter by haversine */
export const VALID_RADII = new Set([5, 10, 15, 20, 25, 50])
