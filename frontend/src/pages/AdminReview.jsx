import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { useApi, useMutation } from '../hooks/useApi.js'
import { foodLabel, dateTimeOf, relative, isUrgent } from '../lib/format.js'

/**
 * Turns donation ids into something a person can read.
 *
 * The matching cycle and the waitlist both report bare identifiers — a UUID
 * tells an administrator nothing about which food went where, which is the only
 * question this screen exists to answer. Each donation is fetched once and
 * cached, and the detail carries the matched organisation's name with it.
 */
function useDonationNames(ids) {
  const [byId, setById] = useState({})
  const key = ids.join(',')

  useEffect(() => {
    let alive = true
    const missing = ids.filter((id) => id && !byId[id])
    if (!missing.length) return
    Promise.all(missing.map((id) =>
      api.donationDetail(id).then((d) => [id, d]).catch(() => [id, null]),
    )).then((pairs) => {
      if (!alive) return
      setById((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return useCallback((id) => {
    const d = byId[id]
    if (!d) return null
    const accepted = (d.matches ?? []).find((m) => m.status === 'ACCEPTED')
    const pending = (d.matches ?? []).find((m) => m.status === 'PENDING')
    const m = accepted ?? pending ?? null
    return {
      label: `${d.donation.quantity_servings} servings · ${foodLabel(String(d.donation.food_type ?? '').toUpperCase())}`,
      description: d.donation.description,
      donor: d.donation.donor_name,
      org: m?.recipient_name ?? null,
      score: m?.score ?? null,
      distanceKm: m?.distance_km ?? null,
    }
  }, [byId])
}

/**
 * Administrator review queue.
 *
 * Every donation enters at PENDING_REVIEW and reaches organisations only once
 * an administrator approves it, so this screen is on the critical path: a
 * donation sitting here unreviewed is losing the window it has left. The
 * deadline is therefore the most prominent thing on each row.
 */
export function AdminReview() {
  const queue = useApi(() => api.pendingReview(), [])
  const waitlist = useApi(() => api.waitlist(), [])
  const matching = useMutation((strategy) => api.runMatching(strategy))
  const [cycle, setCycle] = useState(null)

  // Resolve every id this screen is about to show, from both sources at once.
  const describe = useDonationNames([
    ...(cycle?.assignments ?? []).map((a) => a.donationId),
    ...(waitlist.data?.waitlist ?? []).map((w) => w.donation_id),
  ].filter(Boolean))

  const runCycle = async (strategy) => {
    const r = await matching.mutate(strategy)
    if (r.ok) { setCycle(r.data); queue.reload(); waitlist.reload() }
  }

  return (
    <>
      <div className="page-head">
        <h1>Review queue</h1>
        <p className="muted">Donations waiting for approval before they can be matched.</p>
      </div>

      <div className="stack-lg">
        <section className="stack">
          {queue.loading && <div className="skeleton" style={{ height: 120 }} aria-busy="true" />}
          {queue.error && <div className="banner" data-kind="error" role="alert">{queue.error.message}</div>}
          {queue.data && (queue.data.donations ?? []).length === 0 && (
            <div className="empty"><p>Nothing waiting for review.</p></div>
          )}
          {(queue.data?.donations ?? []).map((d) => (
            <ReviewCard key={d.donation_id} d={d} onDone={() => { queue.reload(); waitlist.reload() }} />
          ))}
        </section>

        <section className="card stack">
          <h2>Run a matching cycle</h2>
          <p className="muted">
            Offers every approved, unmatched donation to its best-fit organisation.
            Greedy processes donations one at a time; Hungarian solves all open
            donations together.
          </p>
          {matching.error && <div className="banner" data-kind="error" role="alert">{matching.error.message}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn-primary" style={{ flex: 1 }} disabled={matching.busy}
              onClick={() => runCycle('greedy')}>
              {matching.busy ? 'Running…' : 'Run greedy'}
            </button>
            <button style={{ flex: 1 }} disabled={matching.busy} onClick={() => runCycle('hungarian')}>
              Run Hungarian
            </button>
          </div>
          {cycle && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="banner" data-kind="ok">
                <strong>{cycle.strategy}</strong> · {cycle.assignments?.length ?? 0} matched
                · {cycle.waitlisted?.length ?? 0} waitlisted
                {cycle.expiredDonations?.length ? ` · ${cycle.expiredDonations.length} expired` : ''}
              </div>

              {(cycle.assignments ?? []).map((a) => {
                const d = describe(a.donationId)
                return (
                  <div key={a.donationId} className="spread" style={{ alignItems: 'flex-start', gap: 12 }}>
                    <span>
                      <strong>{d ? d.label : 'Donation'}</strong>
                      {d?.description ? <span className="muted"> — {d.description}</span> : null}
                    </span>
                    <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <strong>{d?.org ?? 'an organisation'}</strong>
                      <span className="muted">
                        {' '}· score {Number(a.totalScore ?? a.score ?? 0).toFixed(3)}
                        {a.distanceKm != null ? ` · ${Number(a.distanceKm).toFixed(1)} km` : ''}
                      </span>
                    </span>
                  </div>
                )
              })}

              {(cycle.assignments ?? []).length === 0 && (
                <p className="muted">
                  Nothing was matched this cycle. Any donation below could not reach an
                  eligible organisation — it stays posted and is retried next cycle.
                </p>
              )}
            </div>
          )}
        </section>

        <section className="card stack">
          <h2>Waitlist</h2>
          <p className="muted">Donations no eligible organisation could take. Never dropped.</p>
          {waitlist.loading && <div className="skeleton" style={{ height: 60 }} aria-busy="true" />}
          {(waitlist.data?.waitlist ?? []).length === 0 && !waitlist.loading && (
            <p className="muted">Empty — every donation has found a candidate.</p>
          )}
          {(waitlist.data?.waitlist ?? []).map((w, i) => {
            const d = describe(w.donation_id)
            return (
              <div key={w.donation_id ?? i} className="spread" style={{ alignItems: 'flex-start', gap: 12 }}>
                <span>
                  <strong>{d ? d.label : 'Loading…'}</strong>
                  {d?.description ? <span className="muted"> — {d.description}</span> : null}
                  {d?.donor ? <span className="muted"> · from {d.donor}</span> : null}
                </span>
                <span className="muted" style={{ textAlign: 'right', flex: '0 0 42%' }}>
                  {w.reason ?? 'no eligible organisation'}
                  {w.attempts > 1 ? ` (${w.attempts} attempts)` : ''}
                </span>
              </div>
            )
          })}
        </section>
      </div>
    </>
  )
}

function ReviewCard({ d, onDone }) {
  const [remarks, setRemarks] = useState('')
  const review = useMutation((decision) => api.reviewDonation(d.donation_id, decision, remarks))
  const urgent = isUrgent(d.expires_at)

  const decide = async (decision) => { const r = await review.mutate(decision); if (r.ok) onDone() }

  return (
    <article className="card stack">
      <div className="spread">
        <strong>{d.quantity_servings} servings</strong>
        <span className="pill" data-urgent={urgent}>Expires {relative(d.expires_at)}</span>
      </div>
      {d.description && <p>{d.description}</p>}
      <div className="row" style={{ gap: 8 }}>
        <span className="muted">{foodLabel(d.food_type)}</span>
        {d.donor_name && <><span className="muted" aria-hidden="true">·</span><span className="muted">{d.donor_name}</span></>}
        {d.pickup_address && <><span className="muted" aria-hidden="true">·</span><span className="muted">{d.pickup_address}</span></>}
      </div>
      <div className="muted" style={{ fontSize: '.8125rem' }}>Submitted {dateTimeOf(d.submitted_at ?? d.created_at)}</div>

      {review.error && <div className="banner" data-kind="error" role="alert">{review.error.message}</div>}

      <input value={remarks} onChange={(e) => setRemarks(e.target.value)}
        placeholder="Remarks (required when rejecting)" aria-label="Review remarks" />

      <div className="row" style={{ gap: 8 }}>
        <button className="btn-primary" style={{ flex: 1 }} disabled={review.busy}
          onClick={() => decide('APPROVED')}>
          {review.busy ? 'Saving…' : 'Approve'}
        </button>
        <button className="btn-danger" style={{ flex: 1 }} disabled={review.busy || !remarks.trim()}
          onClick={() => decide('REJECTED')} title={!remarks.trim() ? 'Add remarks before rejecting' : undefined}>
          Reject
        </button>
      </div>
    </article>
  )
}
