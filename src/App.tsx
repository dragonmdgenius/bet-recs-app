import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import './App.css'

type PickOutcome = 'pending' | 'won' | 'lost'

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

type SavedPick = RecommendedPick & {
  savedAt: string
  status: PickOutcome
}

const STORAGE_KEY = 'bet-recs-history-v1'
const BOOKMAKER_TARGET = 'hardrockbet'

function toDisplayOdds(price: number) {
  return price > 0 ? `+${price}` : `${price}`
}

function getSavedPicks(): SavedPick[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as SavedPick[]
  } catch {
    return []
  }
}

function persistPicks(picks: SavedPick[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(picks))
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

async function fetchOdds(): Promise<{ recommendations: RecommendedPick[]; parlay?: RecommendedPick | null; warnings: string[] }> {
  const res = await fetch('/api/odds')
  if (!res.ok) {
    const data = await res.json().catch(() => ({ warnings: ['Failed to load live odds.'] }))
    return { recommendations: [], parlay: null, warnings: data.warnings || ['Failed to load live odds.'] }
  }
  return res.json()
}

function App() {
  const [saved, setSaved] = useState<SavedPick[]>([])
  const [recommendations, setRecommendations] = useState<RecommendedPick[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [serverParlay, setServerParlay] = useState<RecommendedPick | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSaved(getSavedPicks())
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchOdds()
      .then((data) => {
        if (cancelled) return
        setRecommendations(data.recommendations)
        setServerParlay(data.parlay || null)
        setWarnings(data.warnings)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load odds')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const parlay = useMemo(() => serverParlay || buildParlay(recommendations), [serverParlay, recommendations])

  function savePick(pick: RecommendedPick) {
    if (saved.some((item) => item.id === pick.id)) return
    const next = [{ ...pick, savedAt: new Date().toISOString(), status: 'pending' as const }, ...saved]
    setSaved(next)
    persistPicks(next)
  }

  function updateStatus(id: string, status: PickOutcome) {
    const next = saved.map((pick) => (pick.id === id ? { ...pick, status } : pick))
    setSaved(next)
    persistPicks(next)
  }

  const stats = useMemo(() => {
    const graded = saved.filter((pick) => pick.status !== 'pending')
    const wins = graded.filter((pick) => pick.status === 'won').length
    return {
      total: saved.length,
      graded: graded.length,
      wins,
      losses: graded.length - wins,
      winRate: graded.length ? Math.round((wins / graded.length) * 100) : 0,
    }
  }, [saved])

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Live Hard Rock-style board intelligence</span>
          <h1>Daily sports bet recommendations with live odds, saved picks, and result tracking.</h1>
          <p>
            Focused on NBA, MLB, and soccer. The app surfaces three top plays for the day plus one 3-leg parlay, lets you save them,
            and keeps a running performance history after games settle.
          </p>
          <div className="hero-meta">
            <div>
              <strong>{format(new Date(), 'EEEE, MMM d')}</strong>
              <span> Daily slate</span>
            </div>
            <div>
              <strong>{BOOKMAKER_TARGET}</strong>
              <span> target bookmaker feed</span>
            </div>
          </div>
        </div>
      </header>

      <main className="content-grid">
        <section className="panel panel-large">
          <div className="panel-header">
            <div>
              <h2>Today&apos;s top recommendations</h2>
              <p>Ranked from current moneyline prices and implied win probability.</p>
            </div>
          </div>

          {loading && <div className="empty-state">Loading live odds and building recommendations...</div>}
          {error && <div className="empty-state error">{error}</div>}
          {!loading && !error && recommendations.length === 0 && (
            <div className="empty-state">No live recommendations are available yet. Add API credentials or check bookmaker coverage.</div>
          )}

          <div className="cards">
            {recommendations.map((pick, index) => (
              <article className="pick-card" key={pick.id}>
                <div className="pick-rank">#{index + 1}</div>
                <div className="pick-topline">
                  <span>{pick.sport}</span>
                  <span>{pick.commenceTime ? format(new Date(pick.commenceTime), 'p MMM d, h:mm a') : ''}</span>
                </div>
                <h3>{pick.selection}</h3>
                <p className="event-label">{pick.eventLabel}</p>
                <div className="pick-metrics">
                  <div>
                    <span>Odds</span>
                    <strong>{toDisplayOdds(pick.odds)}</strong>
                  </div>
                  <div>
                    <span>Confidence</span>
                    <strong>{pick.confidence}%</strong>
                  </div>
                  <div>
                    <span>Market</span>
                    <strong>{pick.market}</strong>
                  </div>
                </div>
                <p className="reasoning">{pick.reasoning}</p>
                <button className="primary-btn" onClick={() => savePick(pick)}>
                  Save recommendation
                </button>
              </article>
            ))}
          </div>

          {parlay && (
            <article className="parlay-card">
              <div className="panel-header compact">
                <div>
                  <h2>3-leg parlay</h2>
                  <p>Built from today&apos;s strongest singles.</p>
                </div>
                <button className="secondary-btn" onClick={() => savePick(parlay)}>
                  Save parlay
                </button>
              </div>
              <div className="parlay-grid">
                <div>
                  <span className="muted">Combined odds</span>
                  <h3>{toDisplayOdds(parlay.odds)}</h3>
                </div>
                <div>
                  <span className="muted">Confidence</span>
                  <h3>{parlay.confidence}%</h3>
                </div>
              </div>
              <ul className="legs-list">
                {parlay.legs?.map((leg) => (
                  <li key={`${leg.eventLabel}-${leg.selection}`}>
                    <strong>{leg.selection}</strong>
                    <span>{leg.eventLabel}</span>
                    <em>{toDisplayOdds(leg.odds)}</em>
                  </li>
                ))}
              </ul>
              <p className="reasoning">{parlay.reasoning}</p>
            </article>
          )}

          {warnings.length > 0 && (
            <div className="warning-box">
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
        </section>

        <aside className="sidebar">
          <section className="panel">
            <div className="panel-header compact">
              <div>
                <h2>Performance tracker</h2>
                <p>Keep score after the games settle.</p>
              </div>
            </div>
            <div className="stats-grid">
              <div><span>Saved</span><strong>{stats.total}</strong></div>
              <div><span>Graded</span><strong>{stats.graded}</strong></div>
              <div><span>Wins</span><strong>{stats.wins}</strong></div>
              <div><span>Win rate</span><strong>{stats.winRate}%</strong></div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header compact">
              <div>
                <h2>Saved picks</h2>
                <p>Persisted in local browser storage.</p>
              </div>
            </div>
            <div className="saved-list">
              {saved.length === 0 && <div className="empty-state">No picks saved yet.</div>}
              {saved.map((pick) => (
                <article className="saved-item" key={pick.id}>
                  <div>
                    <strong>{pick.selection}</strong>
                    <p>{pick.eventLabel}</p>
                    <span>{format(new Date(pick.savedAt), 'MMM d, h:mm a')}</span>
                  </div>
                  <div className="saved-actions">
                    <span className={`status-pill ${pick.status}`}>{pick.status}</span>
                    <div className="result-buttons">
                      <button onClick={() => updateStatus(pick.id, 'won')}>Won</button>
                      <button onClick={() => updateStatus(pick.id, 'lost')}>Lost</button>
                      <button onClick={() => updateStatus(pick.id, 'pending')}>Reset</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}

export default App
