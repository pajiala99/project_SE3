import { DONATION_STATUS_LABEL, dateTimeOf, relative } from '../lib/format.js'

const HAPPY_PATH = ['PENDING_REVIEW', 'POSTED', 'MATCHED', 'PICKED_UP', 'COMPLETED']
const TERMINAL = { REJECTED: 'Rejected at review', CANCELLED: 'Cancelled by the donor', EXPIRED: 'Expired uncollected' }

/**
 * The donation lifecycle, built from the audit trail the backend returns with
 * a donation: its own timestamps plus the reviews, matches and pickups.
 *
 * Two things it must get right, because they are what the status screen is
 * judged on: a stage that has happened shows *when*, and a donation that ended
 * early stops where it actually stopped instead of pretending the remaining
 * stages are merely pending.
 */
export function StatusTimeline({ donation, reviews = [], matches = [], pickups = [] }) {
  const ended = TERMINAL[donation.status]
  const pickup = pickups[0] ?? null
  const acceptedMatch = matches.find((m) => m.status === 'ACCEPTED') ?? null

  // When each stage happened, from whichever record actually recorded it.
  const at = {
    PENDING_REVIEW: donation.submitted_at ?? donation.created_at,
    POSTED: donation.posted_at,
    MATCHED: donation.matched_at ?? acceptedMatch?.created_at ?? null,
    PICKED_UP: pickup?.picked_up_at ?? null,
    COMPLETED: pickup?.completed_at ?? null,
  }

  const note = {
    PENDING_REVIEW: 'Submitted for administrator review',
    POSTED: reviews.find((r) => r.decision === 'APPROVED') ? 'Approved and open for matching' : null,
    MATCHED: acceptedMatch?.recipient_name ? `Accepted by ${acceptedMatch.recipient_name}` : null,
    PICKED_UP: 'Collected',
    COMPLETED: 'Redistribution confirmed',
  }

  const reachedIdx = ended
    ? HAPPY_PATH.reduce((best, s, i) => (at[s] ? i : best), -1)
    : HAPPY_PATH.indexOf(donation.status)

  return (
    <ol className="timeline">
      {HAPPY_PATH.map((stage, i) => {
        const done = i <= reachedIdx
        const state = ended ? (done ? 'done' : 'pending')
          : i === reachedIdx ? 'current' : done ? 'done' : 'pending'
        return (
          <li key={stage} className="tl-step" data-state={state}>
            <div className="tl-rail">
              <span className="tl-dot" />
              {i < HAPPY_PATH.length - 1 && <span className="tl-line" />}
            </div>
            <div className="tl-body">
              <div className="tl-title">{DONATION_STATUS_LABEL[stage]}</div>
              {at[stage]
                ? <div className="tl-meta">
                    {dateTimeOf(at[stage])} · {relative(at[stage])}{note[stage] ? ` · ${note[stage]}` : ''}
                  </div>
                : <div className="tl-meta">Not yet</div>}
            </div>
          </li>
        )
      })}

      {ended && (
        <li className="tl-step" data-state="failed">
          <div className="tl-rail"><span className="tl-dot" /></div>
          <div className="tl-body">
            <div className="tl-title">{DONATION_STATUS_LABEL[donation.status]}</div>
            <div className="tl-meta">
              {ended}
              {reviews.find((r) => r.decision === 'REJECTED')?.remarks
                ? ` — ${reviews.find((r) => r.decision === 'REJECTED').remarks}` : ''}
            </div>
          </div>
        </li>
      )}
    </ol>
  )
}
