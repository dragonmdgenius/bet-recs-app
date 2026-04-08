# Bet Recs App

A Vite + React web app that surfaces daily sports betting recommendations for NBA, MLB, and soccer using live odds data, with saved picks, result grading, and history tracking.

## What it does

- Pulls live odds from a real odds API
- Targets a bookmaker feed via server env `TARGET_BOOKMAKER` (default: `hardrockbet`)
- Shows 3 recommended daily singles based on current moneyline implied probability
- Builds 1 three-leg parlay from the top singles
- Lets users save recommendations locally
- Lets users grade picks as won/lost/pending
- Tracks simple performance history in local browser storage

## Important compliance note

This app does **not** guarantee winnings and should not present gambling outcomes as certain. Recommendations are generated from market odds and simple ranking logic. If you need sharper recommendation quality, add a stronger model layer, injury/news ingestion, line movement tracking, and closing-line-value analysis.

## Live data provider

This project is wired for a live odds API via environment variables. By default it uses The Odds API style endpoints:

- Base: `https://api.the-odds-api.com/v4`
- Server env var: `ODDS_API_KEY`

If `hardrockbet` is unsupported by your odds provider, switch `TARGET_BOOKMAKER` to a supported bookmaker key, or adapt the fetch layer.

## Local setup

```bash
npm install
cp .env.example .env
# then map values to server envs for deployment
npm run dev
```

Then open the local URL shown by Vite.

## Build

```bash
npm run build
npm run preview
```

## Deploy to Vercel

### Option A: GitHub + Vercel

1. Push repo to GitHub
2. Import repo in Vercel
3. Add environment variables in Vercel:
   - `ODDS_API_KEY`
   - `ODDS_API_BASE`
   - `TARGET_BOOKMAKER`
4. Deploy

### Option B: Vercel CLI

```bash
vercel
vercel --prod
```

## Architecture

- `src/App.tsx`: UI, saved picks, history, display logic
- `api/odds.ts`: server-side live odds fetch and recommendation ranking
- `src/App.css`: app styling
- `localStorage`: saved picks and grading history

## Next improvements

- Real post-game result reconciliation via scores API instead of manual grading
- User auth and cloud persistence
- Better recommendation engine using injuries, recent form, line movement, and market consensus
- Filters by league, date, bet type
- EV and CLV tracking
