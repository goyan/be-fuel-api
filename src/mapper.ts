import type { BEStation, GasPriceStation } from './types.js'

export function mapToGasPriceStation(station: BEStation): GasPriceStation {
  const lat = station.lat ?? 0
  const lng = station.lng ?? 0

  const { prices, updatedAt, pricesUpdatedAt: pua } = station

  const datFor = (fuel: 'diesel' | 'sp95' | 'sp98' | 'lpg' | 'e85' | 'ev'): string | null =>
    prices[fuel] !== null ? (pua?.[fuel] ?? updatedAt) : null

  const sp95Maj = datFor('sp95')

  const carburants_disponibles: string[] = []
  if (prices.diesel !== null) carburants_disponibles.push('Gazole')
  if (prices.sp95 !== null) carburants_disponibles.push('SP95-E10')
  if (prices.sp98 !== null) carburants_disponibles.push('SP98')
  if (prices.lpg !== null) carburants_disponibles.push('GPLc')
  if (prices.e85 !== null) carburants_disponibles.push('E85')
  if (prices.ev !== null) carburants_disponibles.push('Electrique')

  return {
    id: station.id,
    adresse: station.address,
    ville: station.city,
    cp: station.postalCode,
    latitude: lat,
    longitude: lng,
    geom: { lon: lng, lat },
    gazole_prix: prices.diesel,
    gazole_maj: datFor('diesel'),
    sp95_prix: prices.sp95,
    sp95_maj: sp95Maj,
    sp98_prix: prices.sp98,
    sp98_maj: datFor('sp98'),
    e10_prix: prices.sp95,
    e10_maj: sp95Maj,
    e85_prix: prices.e85,
    e85_maj: datFor('e85'),
    gplc_prix: prices.lpg,
    gplc_maj: datFor('lpg'),
    ev_prix: prices.ev,
    ev_maj: datFor('ev'),
    carburants_disponibles,
    services_service: [],
    horaires_automate_24_24: '',
  }
}
