import { api } from '../api/client.js'
import { useApi, useMutation, useTicker } from '../hooks/useApi.js'
import { PICKUP_STATUS_LABEL, foodLabel, dateTimeOf, relative } from '../lib/format.js'

const OPEN = ['SCHEDULED', 'PICKED_UP']

/**
 * Collections a recipient has committed to.
 *
 * Without this screen an accepted match disappears: the organisation has agreed
 * to collect food and has nowhere to see where it is, when it is scheduled, or
 * who to contact. The two buttons are the two transitions the backend allows —
 * collected, then received.
 */
export function Pickups() {
  const { data, loading, error, reload } = useApi(() => api.myPickups(), [])
  useTicker(30000)

  if (loading) return <div className="stack" aria-busy="true">{[0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 120 }} />)}</div>
  if (error) return <div className="banner" data-kind="error" role="alert">{error.message}</div>

  const items = data?.pickups ?? []
  const open = items.filter((p) => OPEN.includes(p.status))
  const past = items.filter((p) => !OPEN.includes(p.status))

  return (
    <>
      <div className="page-head">
        <h1>Collections</h1>
        <p className="muted">Donations your organisation has accepted.</p>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <p>Nothing accepted yet.</p>
          <p className="muted">Offers you accept appear here with the pickup details.</p>
        </div>
      ) : (
        <div className="stack-lg">
          {open.length > 0 && (
            <section className="stack">
              <h2>To collect</h2>
              {open.map((p) => <PickupCard key={p.pickup_id} p={p} onDone={reload} />)}
            </section>
          )}
          {past.length > 0 && (
            <section className="stack">
              <h2>Past collections</h2>
              {past.map((p) => <PickupCard key={p.pickup_id} p={p} onDone={reload} />)}
            </section>
          )}
        </div>
      )}
    </>
  )
}

function PickupCard({ p, onDone }) {
  const pickedUp = useMutation(() => api.markPickedUp(p.pickup_id))
  const complete = useMutation(() => api.markCompleted(p.pickup_id))
  const busy = pickedUp.busy || complete.busy
  const err = pickedUp.error || complete.error

  const run = async (fn) => { const r = await fn(); if (r.ok) onDone() }

  return (
    <article className="card stack">
      <div className="spread">
        <strong>{p.quantity_servings != null ? `${p.quantity_servings} servings` : 'Collection'}</strong>
        <span className="pill" data-status={p.status}>{PICKUP_STATUS_LABEL[p.status] ?? p.status}</span>
      </div>

      {p.food_type && <div className="muted">{foodLabel(p.food_type)}</div>}
      {p.pickup_address && <div className="muted">Collect from {p.pickup_address}</div>}
      {p.scheduled_at && (
        <div className="muted">Scheduled {dateTimeOf(p.scheduled_at)} · {relative(p.scheduled_at)}</div>
      )}
      {p.contact_details && (
        <div className="stack" style={{ gap: 2 }}>
          <span className="muted" style={{ fontSize: '.8125rem' }}>Contact</span>
          <span>{p.contact_details}</span>
        </div>
      )}

      {err && <div className="banner" data-kind="error" role="alert">{err.message}</div>}

      {p.status === 'SCHEDULED' && (
        <button className="btn-primary btn-block" disabled={busy} onClick={() => run(pickedUp.mutate)}>
          {pickedUp.busy ? 'Saving…' : 'We have collected it'}
        </button>
      )}
      {p.status === 'PICKED_UP' && (
        <button className="btn-primary btn-block" disabled={busy} onClick={() => run(complete.mutate)}>
          {complete.busy ? 'Saving…' : 'Confirm redistribution complete'}
        </button>
      )}
    </article>
  )
}
