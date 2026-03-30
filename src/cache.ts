import NodeCache from 'node-cache'

const ttl = parseInt(process.env.CACHE_TTL || '3600', 10)

const cache = new NodeCache({ stdTTL: ttl, checkperiod: ttl * 0.2 })

export function getCached<T>(key: string): T | undefined {
  const value = cache.get<T>(key)
  if (value !== undefined) {
    console.log(`[CACHE HIT] ${key}`)
    return value
  }
  console.log(`[CACHE MISS] ${key}`)
  return undefined
}

export function setCached<T>(key: string, value: T): void {
  cache.set(key, value)
}

export function buildCacheKey(fuel: string, postal: string, town: string, radius: number): string {
  return `BE_${fuel}_${postal}_${town}_${radius}`
}
