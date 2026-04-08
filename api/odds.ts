import type { VercelRequest, VercelResponse } from '@vercel/node'

type SportKey = 'basketball_nba' | 'baseball_mlb' | 'soccer_epl'

type OddsMarket = {
  key: string
  outcomes: Array<{
    name: string
    price: number
    point?: number
  }>
}

type Bookmaker = {
  key: string
  title: string
  markets: OddsMarket[]
}

type OddsEvent = {
  id: string
  sport_key: SportKey
  sport_title: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: Bookmaker[]
}

type RecommendedPick = {
  id: string
  type: 'single' | 'parlay'
  sport: string
  eventLabel: string
  market: string
  selection: string
  odds: number
  confidence: number
  reasoning: string
  commenceTime?: string
  legs?: Array<{ eventLabel: string; selection: string; odds: number }>
}

const SPORTS: Array<{ key: SportKey; label: string }> = [
  { key: 'basketball_nba', label: 'NBA' },
  { key: 'baseball_mlb', label: 'MLB' },
  { key: 'soccer_epl', label: 'Soccer' },
]

const API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4'
const API_KEY = process.env.ODDS_API_KEY
const BOOKMAKER_TARGET = (process.env.TARGET_BOOKMAKER || 'hardrockbet').toLowerCase()

function americanToConfidence(price: number) {
  if (price < 0) return Math.round((Math.abs(price) / (Math.abs(price) + 100)) * 100)
  return Math.round((100 / (price + 100)) * 100)
}

function rankRecommendation(event: OddsEvent, bookmaker: Bookmaker | undefined): RecommendedPick | null {
  if (!bookmaker) return null
  const h2h = bookmaker.markets.find((market) => market.key === 'h2h')
  if (!h2h) return null
  const sorted = [...h2h.outcomes].sort((a, b) => americanToConfidence(b.price) - americanToConfidence(a.price))
  const best = sorted[0]
  if (!best) return null
  const confidence = americanToConfidence(best.price)
  const startsSoon = new Date(event.commence_time).getTime() - Date.now() < 1000 * 60 * 60 * 24
  return {
    id: `${event.id}-${best.name}`,
    type: 'single',
    sport: event.sport_title,
    eventLabel: `${event.away_team} @ ${event.home_team}`,
    market: 'Moneyline',
    selection: best.name,
    odds: best.price,
    confidence: Math.min(confidence + (startsSoon ? 2 : 0), 99),
    commenceTime: event.commence_time,
    reasoning:
      confidence >= 60
        ? `Market pricing from ${bookmaker.title} leans clearly toward ${best.name}. This is one of the stronger moneyline edges on the board right now.`
        : `This is the cleanest available side from ${bookmaker.title} for this matchup, though edge strength is more moderate than elite.`,
  }
}

function buildParlay(recommendations: RecommendedPick[]) {
  const legs = recommendations.slice(0, 3)
  if (legs.length < 3) return null
  const decimalProduct = legs.reduce((acc, pick) => {
    const decimal = pick.odds > 0 ? 1 + pick.odds / 100 : 1 + 100 / Math.abs(pick.odds)
    return acc * decimal
  }, 1)
  const parlayOdds = decimalProduct >= 2 ? Math.round((decimalProduct - 1) * 100) : Math.round(-100 / (decimalProduct - 1))
  const avgConfidence = Math.round(legs.reduce((sum, pick) => sum + pick.confidence, 0) / legs.length)
  return {
    id: `parlay-${legs.map((leg) => leg.id).join('-')}`,
    type: 'parlay' as const,
    sport: 'Mixed Slate',
    eventLabel: '3-leg confidence parlay',
    market: 'Parlay',
    selection: legs.map((leg) => leg.selection).join(' • '),
    odds: parlayOdds,
    confidence: Math.max(avgConfidence - 8, 45),
    reasoning: 'Built from the three strongest current singles on the board. Higher payout, but naturally lower hit rate than the individual picks.',
    legs: legs.map((leg) => ({ eventLabel: leg.eventLabel, selection: leg.selection, odds: leg.odds })),
  }
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (!API_KEY) {
    return res.status(500).json({ recommendations: [], warnings: ['Missing server-side ODDS_API_KEY.'] })
  }

  try {
    const warnings: string[] = []
    const responses = await Promise.all(
      SPORTS.map(async ({ key }) => {
        const url = `${API_BASE}/sports/${key}/odds?apiKey=${API_KEY}&regions=us&markets=h2h&oddsFormat=american&bookmakers=${BOOKMAKER_TARGET}`
        const response = await fetch(url)
        if (!response.ok) {
          warnings.push(`Could not load ${key} odds (${response.status}).`)
          return [] as OddsEvent[]
        }
        return (await response.json()) as OddsEvent[]
      }),
    )

    const allEvents = responses.flat()
    const recommendations = allEvents
      .map((event) => {
        const bookmaker = event.bookmakers.find((book) => book.key.toLowerCase() === BOOKMAKER_TARGET) || event.bookmakers[0]
        return rankRecommendation(event, bookmaker)
      })
      .filter((pick): pick is RecommendedPick => Boolean(pick))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3)

    const parlay = buildParlay(recommendations)
    return res.status(200).json({ recommendations, parlay, warnings })
  } catch (error) {
    return res.status(500).json({ recommendations: [], warnings: [error instanceof Error ? error.message : 'Unknown error'] })
  }
}
