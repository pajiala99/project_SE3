import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { api } from '../api/client.js'
import { useApi } from '../hooks/useApi.js'
import { num, pct, secondsToMinutes } from '../lib/format.js'

/** The proposal's stated target: median time-to-match at or under 20 minutes. */
const TTM_TARGET_MIN = 20

/**
 * Impact dashboard.
 *
 * Every number comes from GET /impact/summary, computed server-side from
 * persisted timestamps — the browser never derives a metric, so the figure on
 * screen is the same figure quoted in the report. That includes the three the
 * evaluation plan names and the backend only recently began returning: rescue
 * rate, first-offer acceptance, and mean distance per allocation strategy.
 */
export function ImpactDashboard() {
  const { data, loading, error } = useApi(() => api.impactSummary(), [])

  if (loading) return <div className="skeleton" style={{ height: 300 }} aria-busy="true" />
  if (error) return <div className="banner" data-kind="error" role="alert">{error.message}</div>

  const s = data
  const medianMin = secondsToMinutes(s.timeToMatch?.medianSeconds)
  const avgMin = secondsToMinutes(s.timeToMatch?.avgSeconds)
  const donors = (s.topDonors ?? []).map((d) => ({ name: d.name, meals: Number(d.meals) }))
  const byStrategy = s.meanDistanceKmByStrategy ?? {}

  return (
    <>
      <div className="page-head">
        <h1>Impact</h1>
        <p className="muted">Measured from system timestamps, not self-report.</p>
      </div>

      <div className="stack-lg">
        <section className="kpis">
          <Kpi label="Meals redistributed" value={num(s.mealsRedistributed)}
            note={plural(s.completedDonations, 'completed donation')} />
          <Kpi label="Median time to match"
            value={medianMin == null ? '—' : `${medianMin} min`}
            note={`Target ≤ ${TTM_TARGET_MIN} min · ${plural(s.timeToMatch?.samples ?? 0, 'sample')}`}
            target={medianMin == null ? undefined : medianMin <= TTM_TARGET_MIN ? 'hit' : 'miss'} />
          <Kpi label="Rescue rate" value={pct(s.rescueRate?.rate)}
            note={`${s.rescueRate?.rescued ?? 0} rescued of ${s.rescueRate?.resolved ?? 0} resolved`} />
          <Kpi label="First-offer acceptance" value={pct(s.firstOfferAcceptance?.rate)}
            note={`${s.firstOfferAcceptance?.accepted ?? 0} accepted of ${s.firstOfferAcceptance?.decided ?? 0} answered`} />
          <Kpi label="Unmatched rate" value={pct(s.unmatchedRate)}
            note={`${s.unmatchedCount} never matched`} />
          <Kpi label="Lost to expiry" value={num(s.expiredCount)}
            note="Counted against the system" />
        </section>

        <section className="card stack">
          <h2>Waste diverted</h2>
          <p className="muted">
            {num(s.wasteDivertedKg, ' kg')} of food kept out of waste, assuming
            {' '}{s.wasteAssumptionKgPerServing} kg per serving. The assumption is
            configuration, not a measurement — it is stated so the figure can be
            recomputed if the estimate changes.
          </p>
        </section>

        <section className="card stack">
          <div>
            <h2>Meals by donor</h2>
            <p className="muted">Completed redistributions, by the organisation that gave the food.</p>
          </div>
          {donors.length === 0 ? (
            <p className="empty">No completed donations yet.</p>
          ) : (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={220} minWidth={280}>
                <BarChart data={donors} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--ink-muted)" fontSize={12}
                    tickLine={false} axisLine={false} interval={0} />
                  <YAxis stroke="var(--ink-muted)" fontSize={12} tickLine={false}
                    axisLine={false} width={44} allowDecimals={false} />
                  <Tooltip content={<Card unit=" meals" />} cursor={{ fill: 'var(--surface-2)' }} />
                  {/* Animation off deliberately. Recharts animates bars up from
                      zero height, and the stylesheet collapses animation
                      durations under prefers-reduced-motion — which left the
                      bars never painted for anyone with that setting on. A
                      chart must not depend on motion to be readable. */}
                  <Bar dataKey="meals" fill="var(--accent)" radius={[4, 4, 0, 0]}
                    maxBarSize={48} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="card stack">
          <div>
            <h2>Distance by allocation strategy</h2>
            <p className="muted">
              Mean donor-to-recipient distance of the offers each strategy made. A
              strategy that has not run yet has no distance to report, so this
              compares the two only once both have been used.
            </p>
          </div>
          <Line label="Greedy best-fit"
            value={num(byStrategy.greedy?.meanKm, ' km')}
            note={plural(byStrategy.greedy?.offers ?? 0, 'offer')} />
          <Line label="Hungarian global assignment"
            value={num(byStrategy.hungarian?.meanKm, ' km')}
            note={plural(byStrategy.hungarian?.offers ?? 0, 'offer')} />
        </section>

        <section className="card stack">
          <h2>Backlog</h2>
          <Line label="Waitlisted (no eligible organisation)" value={num(s.waitlistedCount)} />
          <Line label="Mean time to match" value={avgMin == null ? '—' : `${avgMin} min`} />
        </section>
      </div>
    </>
  )
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function Kpi({ label, value, note, target }) {
  return (
    <div className="kpi" data-target={target}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  )
}

/** `note` carries the sample size, so an average is never read without it. */
function Line({ label, value, note }) {
  return (
    <div className="spread">
      <span className="muted">{label}</span>
      <span className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        {note && <span className="hint">{note}</span>}
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
      </span>
    </div>
  )
}

/** Tooltip styled from the same tokens as the rest of the page. */
function Card({ active, payload, label, unit = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8,
      padding: '8px 10px', fontSize: '.8125rem', boxShadow: '0 4px 14px rgba(0,0,0,.12)',
    }}>
      <div className="muted">{label}</div>
      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{payload[0].value}{unit}</strong>
    </div>
  )
}
