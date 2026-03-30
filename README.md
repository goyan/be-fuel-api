# be-fuel-api

Microservice Node.js/TypeScript qui scrape les prix des carburants belges sur [carbu.com](https://carbu.com/belgique) et expose une API REST JSON.

Consommé par l'app [gasPrice](https://github.com/goyan/gasPrice).

## Stack

| | |
|-|-|
| Runtime | Node.js 20 LTS |
| Framework | Fastify 4 |
| Scraping | cheerio |
| Cache | node-cache (TTL 1h) |
| Lang | TypeScript strict |
| Conteneur | Docker alpine |
| Reverse proxy | Traefik v2 |
| Domaine | `be-fuel.goyan.fr` |

## Installation locale

```bash
npm install
cp .env.example .env
npm run dev        # tsx watch, port 3001
```

## API

### `GET /stations`

Stations proches d'un code postal belge pour un type de carburant.

| Param | Obligatoire | Exemple | Description |
|-|-|-|-|
| `fuel` | oui | `diesel` | `diesel`, `sp95`, `sp98`, `lpg`, `e85` |
| `postal` | oui | `7700` | Code postal belge (4 chiffres) |
| `town` | oui | `MOUSCRON` | Nom de ville (majuscules) |
| `radius` | non | `10` | `5`, `10`, `20` km (défaut: 10) |

```bash
curl "http://localhost:3001/stations?fuel=diesel&postal=7700&town=MOUSCRON"
```

```json
{
  "country": "BE",
  "fuelType": "diesel",
  "postalCode": "7700",
  "town": "MOUSCRON",
  "count": 8,
  "fetchedAt": "2026-03-30T11:00:00.000Z",
  "stations": [
    {
      "id": "BE_21457",
      "name": "Total Mouscron Centre",
      "brand": "Total",
      "address": "Rue de Namur 12",
      "city": "Mouscron",
      "postalCode": "7700",
      "country": "BE",
      "lat": 50.7453,
      "lng": 3.2097,
      "prices": { "diesel": 1.789, "sp95": null, "sp98": null, "lpg": null, "e85": null },
      "updatedAt": "2026-03-30T08:00:00.000Z"
    }
  ]
}
```

### `GET /official`

Prix maximums officiels belges du jour (Statbel).

```bash
curl "http://localhost:3001/official"
```

```json
{
  "date": "2026-03-30",
  "source": "statbel.fgov.be",
  "prices": { "diesel": 1.923, "sp95_e10": 1.677, "sp98_e5": 1.684, "lpg": 0.871 }
}
```

### `GET /health`

```json
{ "status": "ok", "uptime": 3600 }
```

## Erreurs

| Code | Cas |
|-|-|
| 400 | Param manquant, fuel invalide, postal invalide |
| 503 | carbu.com ou Statbel inaccessible |
| 200 | Aucune station = `{ count: 0, stations: [] }` |

## Scraping carbu.com

URL pattern :
```
https://carbu.com/belgique/index.php/liste-stations-service/{fuelLabel}/{town}/{postal}/{radiusCode}
```

| fuel | fuelLabel |
|-|-|
| diesel | `Diesel%20(B7)` |
| sp95 | `Super%2095%20(E10)` |
| sp98 | `Super%2098%20(E5)` |
| lpg | `LPG` |
| e85 | `Super%20E85` |

| radius (km) | radiusCode |
|-|-|
| 5 | `BE_ht_1578` |
| 10 | `BE_ht_1579` |
| 20 | `BE_ht_1580` |

Les sélecteurs CSS dans `scraper.ts` doivent etre validés contre le HTML réel de carbu.com (ils peuvent évoluer).

## Cache

- TTL : 1h (configurable via `CACHE_TTL`)
- Clé : `BE_{fuel}_{postal}_{town}_{radius}`
- Logs : `[CACHE HIT]` / `[CACHE MISS]`

## Variables d'environnement

```env
PORT=3001
LOG_LEVEL=info            # debug | info | warn | error
CACHE_TTL=3600            # secondes
CARBU_BASE_URL=https://carbu.com/belgique
STATBEL_VIEW_ID=9e9cf394-6c54-4d81-8013-7124a8c4bf15
```

## Deploiement VPS

```bash
docker compose up -d --build
```

Prerequis : Traefik v2 avec reseau `traefik_proxy` et certresolver `letsencrypt`.

## CORS

Origines autorisées :
- `https://gasprice.vercel.app`
- `http://localhost:5173`
- `https://*.vercel.app`

## Tests

```bash
npm test           # vitest run
npm run test:watch # vitest watch
```

## Structure

```
be-fuel-api/
├── src/
│   ├── index.ts              # Fastify server, routes
│   ├── scraper.ts            # fetch + parse HTML carbu.com
│   ├── official.ts           # prix officiels Statbel
│   ├── cache.ts              # wrapper node-cache
│   ├── types.ts              # interfaces TypeScript
│   ├── __tests__/
│   │   ├── scraper.test.ts   # parsing HTML fixtures
│   │   └── api.test.ts       # routes fastify.inject()
│   └── __fixtures__/
│       └── carbu-sample.html # fixture HTML pour tests
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
└── tsconfig.json
```
