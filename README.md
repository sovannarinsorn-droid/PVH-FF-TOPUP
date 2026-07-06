# MRX TOPUP

Modern game top-up storefront with Bakong KHQR auto payment + admin panel for uploading images.

## Setup

```bash
npm install
cp .env.example .env   # fill in your values
npm start
```

Open http://localhost:3000 — admin panel at http://localhost:3000/admin.html
(default password is whatever you set as ADMIN_PASSWORD in .env)

## What's included

- **Storefront** (`public/index.html`) — game grid, ticket-style package cards, KHQR modal with live status polling.
- **Admin panel** (`public/admin.html`) — password-gated, upload logo / hero banner / per-game images, view live orders.
- **Bakong KHQR** — `server.js` generates a QR + MD5 per order via the `bakong-khqr` package, then polls Bakong's
  `check_transaction_by_md5` endpoint until it's paid.
- **Auto delivery hook** — `autoDeliver()` in `server.js` is where you plug in your reseller/SMM top-up API call.
  Right now it just marks the order `delivered` and pings your Telegram admin bot — wire in the real API call
  where the `TODO` comment is.

## Required env vars

| Var | What it's for |
|---|---|
| `ADMIN_PASSWORD` | admin panel login |
| `BAKONG_ACCOUNT_ID` | your Bakong account, e.g. `yourname@wing` |
| `BAKONG_TOKEN` | Bearer token from the Bakong Open API developer portal — needed to check payment status |
| `TOPUP_RESELLER_API_URL` / `TOPUP_RESELLER_API_KEY` | your top-up provider, for auto-delivery |
| `TELEGRAM_ADMIN_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID` | optional — get pinged when an order pays |

## Notes / things to double check before going live

- `bakong-khqr` package's exact constructor field names/order can shift between versions — check
  `node_modules/bakong-khqr/README.md` after `npm install` against what's in `server.js` and adjust if it drifted.
- Orders and config are stored as flat JSON files (`data/orders.json`, `data/config.json`) — fine for one store,
  but move to a real DB (Postgres/Supabase) once order volume grows, since concurrent writes to a JSON file
  can race.
- Deploy as a **Background Worker / Web Service** on Render (needs a persistent process, not static hosting)
  since it polls Bakong server-side.
- Packages/prices currently live in `data/config.json` — the admin panel here only edits images; if you want
  price editing in the UI too, say so and I'll add a packages editor to the admin panel.
