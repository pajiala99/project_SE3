/**
 * Display vocabulary and formatting.
 *
 * The enum values here mirror backend/src/domain/enums.ts exactly. If the
 * backend adds a status, add it here too — an unmapped status falls back to
 * the raw string rather than rendering blank.
 */

export const DONATION_STATUS_LABEL = {
  PENDING_REVIEW: 'Awaiting review',
  POSTED: 'Posted',
  MATCHED: 'Matched',
  PICKED_UP: 'Picked up',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
}

export const MATCH_STATUS_LABEL = {
  PENDING: 'Awaiting your reply',
  ACCEPTED: 'Accepted',
  REJECTED: 'Declined',
  EXPIRED: 'Expired',
}

export const PICKUP_STATUS_LABEL = {
  SCHEDULED: 'Scheduled',
  PICKED_UP: 'Collected',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export const ROLE_LABEL = { DONOR: 'Donor', RECIPIENT: 'Recipient', ADMIN: 'Administrator' }

export const DONOR_TYPES = [
  ['RESTAURANT', 'Restaurant'], ['HOSTEL', 'Hostel'], ['MESS', 'Mess'],
  ['CATERER', 'Caterer'], ['EVENT_ORGANIZER', 'Event organiser'], ['HOUSEHOLD', 'Household'],
]

export const ORGANIZATION_TYPES = [
  ['NGO', 'NGO'], ['SHELTER', 'Shelter'], ['COMMUNITY_KITCHEN', 'Community kitchen'],
  ['ORPHANAGE', 'Orphanage'], ['OLD_AGE_HOME', 'Old age home'], ['FOOD_BANK', 'Food bank'],
]

/** Free text on the backend; these are the common cases offered as shortcuts. */
// These values must stay in step with the food_preferences an organisation can
// hold, because the matcher filters on an exact match: a donation whose type no
// organisation lists is eligible for nobody and goes straight to the waitlist.
export const FOOD_TYPES = [
  ['COOKED_MEALS', 'Cooked meals'], ['PACKAGED', 'Packaged'],
  ['BAKERY', 'Bakery'], ['PRODUCE', 'Fresh produce'], ['DAIRY', 'Dairy'],
]

export const statusLabel = (s) => DONATION_STATUS_LABEL[s] ?? s
export const foodLabel = (s) => FOOD_TYPES.find(([v]) => v === s)?.[1] ?? s

export const dateTimeOf = (t) =>
  t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—'

export const timeOf = (t) =>
  t ? new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '—'

/** "in 2h 15m" / "12m ago" — the timeline reads better relative than absolute. */
export function relative(t) {
  if (!t) return '—'
  const diff = new Date(t) - Date.now()
  const past = diff < 0
  const mins = Math.round(Math.abs(diff) / 60000)
  if (mins < 1) return past ? 'just now' : 'in under a minute'
  const body = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`
  return past ? `${body} ago` : `in ${body}`
}

export const minutesUntil = (t) => (t ? Math.round((new Date(t) - Date.now()) / 60000) : null)

/** Under an hour of the collection window left. */
export const isUrgent = (expiresAt) => {
  const m = minutesUntil(expiresAt)
  return m != null && m > 0 && m <= 60
}

/** The backend reports time-to-match in seconds; the target is stated in minutes. */
export const secondsToMinutes = (s) => (s == null ? null : Math.round((s / 60) * 10) / 10)

export const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`)
export const num = (v, unit = '') => (v == null ? '—' : `${v}${unit}`)

export function toLocalInputValue(date) {
  const d = new Date(date)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
