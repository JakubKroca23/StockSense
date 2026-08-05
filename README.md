# StockSense

Osobní PWA rádce pro analýzu akcií, komodit a crypto.

- **URL:** https://stocksense.propoj.app
- **Stack:** Next.js PWA + FastAPI + Postgres + Appwrite auth + Traefik + Ollama (CPU) + cloud LLM

## Rychlý start (server)

1. Zkopíruj env a doplň Appwrite / LLM klíče:

```bash
cp .env.example .env
```

2. Traefik síť musí být stejná jako Appwrite (`appwrite` — už na VPS existuje).

3. Spusť stack:

```bash
docker compose up -d --build
```

4. (Volitelně) stáhni lokální model:

```bash
docker compose exec ollama ollama pull qwen2.5:1.5b
```

## Lokální vývoj

```bash
# API
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Web
cd apps/web
cp ../../.env.example .env.local   # uprav NEXT_PUBLIC_*
npm install
npm run dev
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
