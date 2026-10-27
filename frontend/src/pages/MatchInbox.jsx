import { useState } from 'react'
import { api } from '../api/client.js'
import { useApi, useMutation, useTicker } from '../hooks/useApi.js'
import { foodLabel, dateTimeOf, minutesUntil } from '../lib/format.js'

/**
 * Recipient's match inbox — accept or decline an offer.
 *
 * GET /matches/inbox now nests the donation under each match, so the screen
 * renders an offer from one request. It previously fetched each donation
 * separately, one request per pending offer; Person B added the join.
 */
export function MatchInbox() {
  const { data, loading, error, reload } = useApi(() => api.matchInbox(), [])
  useTicker(15000)

  const matches = data?.matches ?? []
  const pending = matches.filter((m) => m.status === 'PENDING')

  if (loading) return <div className="stack" aria-busy="true">{[0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 150 }} />)}</div>
  if (error) return <div className="banner" data-kind="error" role="alert">{error.message}</div>

  return (
    <>
      <div className="page-head">
        <h1>Offers</h1>
        <p className="muted">Donations matched to your organisation.</p>
      </div>

      {pending.length === 0 ? (
        <div className="empty">
          <p>No open offers.</p>
          <p className="muted">You will be notified when a nearby donation matches your capacity.</p>
        </div>
      ) : (
        <div className="stack">
          {pending.map((m) => (
            <MatchCard key={m.match_id} match={m} donation={m.donation} onDone={reload} />
          ))}
        </div>
      )}

      {matches.some((m) => m.status !== 'PENDING') && (
        <section className="stack" style={{ marginTop: 32 }}>
          <h2>Earlier offers</h2>
          {matches.filter((m) => m.status !== 'PENDING').map((m) => (
            <div key={m.match_id} className="card spread">
              <span className="muted">{dateTimeOf(m.created_at)}</span>
              <span className="pill">{m.status}</span>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

const COMPONENT_LABEL = {
  proximity_score: 'How close you are',
  urgency_score: 'How soon it expires',
  capacity_score: 'Fits your remaining capacity',
}

function MatchCard({ match, donation, onDone }) {
  const [showWhy, setShowWhy] = useState(false)
  const accept = useMutation(() => api.acceptMatch(match.match_id))
  const reject = useMutation((reason) => api.rejectMatch(match.match_id, reason))

  const minsLeft = minutesUntil(match.expires_at)
  const critical = minsLeft != null && minsLeft <= 5
  const busy = accept.busy || reject.busy
  const err = accept.error || reject.error

  const run = async (fn, arg) => { const r = await fn(arg); if (r.ok) onDone() }

  return (
    <article className="card stack">
      <div className="spread">
        <strong style={{ fontSize: '1.05rem' }}>
          {donation ? `${donation.quantity_servings} servings` : 'Loading…'}
        </strong>
        {minsLeft != null && (
          <span className="pill" data-urgent={critical}>
            {minsLeft > 0 ? `${minsLeft} min to reply` : 'Expired'}
          </span>
        )}
      </div>

      {donation && (
        <>
          {donation.description && <p>{donation.description}</p>}
          <div className="row" style={{ gap: 8 }}>
            <span className="muted">{foodLabel(donation.food_type)}</span>
            <span className="muted" aria-hidden="true">·</span>
            <span className="muted">{Number(match.distance_km).toFixed(2)} km away</span>
            <span className="muted" aria-hidden="true">·</span>
            <span className="muted">collect by {dateTimeOf(donation.expires_at)}</span>
          </div>
          {donation.pickup_address && <div className="muted">Pickup from {donation.pickup_address}</div>}
        </>
      )}

      {/* Every match stores its score components so an allocation can be
          explained after the fact. This is where that reaches a human. */}
      <button className="btn-sm" onClick={() => setShowWhy((s) => !s)} aria-expanded={showWhy}
        style={{ alignSelf: 'flex-start' }}>
        {showWhy ? 'Hide' : 'Why was this offered to us?'}
      </button>

      {showWhy && (
        <div className="stack" style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 8, gap: 8 }}>
          {Object.entries(COMPONENT_LABEL).map(([k, label]) => (
            <ScoreBar key={k} label={label} value={Number(match[k] ?? 0)} />
          ))}
          <p className="hint">
            Overall fit {Math.round(Number(match.score) * 100)}%
            {match.search_radius_km ? ` · found within ${match.search_radius_km} km` : ''}.
          </p>
        </div>
      )}

      {err && <div className="banner" data-kind="error" role="alert">{err.message}</div>}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn-primary" style={{ flex: 1 }} disabled={busy}
          onClick={() => run(accept.mutate)}>
          {accept.busy ? 'Accepting…' : 'Accept'}
        </button>
        <button className="btn-danger" style={{ flex: 1 }} disabled={busy}
          onClick={() => run(reject.mutate, 'Cannot collect in time')}>
          {reject.busy ? 'Declining…' : 'Decline'}
        </button>
      </div>
      <p className="hint">Declining passes this to the next best organisation straight away.</p>
    </article>
  )
}

function ScoreBar({ label, value }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="spread" style={{ fontSize: '.8125rem' }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(v * 100)}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--line)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${v * 100}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
    </div>
  )
}
