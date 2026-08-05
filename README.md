# StockSense

Osobní PWA rádce pro analýzu akcií, komodit a crypto.

- **URL:** https://stocksense.propoj.app
- **Stack:** Next.js PWA + FastAPI + Postgres + Traefik + Ollama (CPU) + cloud LLM

## Rychlý start (server)

1. Doplň v `.env` heslo a secret + LLM klíče:

```bash
AUTH_PASSWORD=tvoje-heslo
AUTH_SECRET=dlouhy-nahodny-retezec
AUTH_USER_ID=admin
```

2. Traefik síť na VPS se jmenuje `appwrite` (historicky — jen Docker network, ne auth).

3. Spusť stack:

```bash
docker compose up -d --build
```

4. (Volitelně) stáhni lokální model:

```bash
docker compose exec ollama ollama pull qwen2.5:1.5b
```

## Lokální vývoj

Produkční `docker-compose.yml` potřebuje Traefik síť `appwrite` (VPS). Lokálně použij:

```bash
# DB + API (hot-reload) + Ollama
make dev

# Jednou stáhni model
make pull-model-dev

# Frontend s hot-reload (druhý terminál)
make web
```

- Web: http://localhost:3000  
- API: http://localhost:8000/docs  
- Auth: jen heslo z `AUTH_PASSWORD` v `.env`  
- `apps/web/.env.local` míří API na produkci nebo `http://localhost:8000/api`.

Zastavení: `make dev-down`

Alternativa bez Docker API (jen DB/Ollama v Dockeru):

```bash
docker compose -f docker-compose.dev.yml up -d db ollama
cd apps/api && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL=postgresql+asyncpg://stocksense:stocksense@localhost:5432/stocksense \
OLLAMA_BASE_URL=http://localhost:11434 \
uvicorn app.main:app --reload --port 8000
```

## Co je hotové v MVP

- Appwrite login + JWT ověření v API
- Portfolio (ruční), watchlist, home (portfolio + tipy)
- Instrument detail (cena, sparkline, fundament, SEC filings, tip + feedback)
- Scoring engine (fundament/makro/flow/TA) několikrát denně
- Hybrid LLM router (Ollama + Anthropic/OpenAI/Gemini)
- AI chat, denní report, alerty (nový tip, price levels, report)

## Poznámky k datům

Free zdroje: yfinance, Stooq, CCXT, FRED, SEC EDGAR.  
`data_quality` je vždy součástí tipů — dark pool / options flow nejsou fakeované.
