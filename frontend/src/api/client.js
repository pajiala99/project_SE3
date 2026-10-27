/**
 * HTTP client for the FoodBridge backend (Person B).
 *
 * Endpoint names, field names and status values follow backend/src/routes and
 * backend/src/domain/enums.ts. The backend answers with snake_case database
 * rows, so that is what the components consume — no renaming layer, because a
 * silent rename is where drift hides.
 *
 * Auth is a JWT from /auth/login or /auth/register, held in localStorage and
 * sent as a Bearer token on every other call.
 */

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT ?? 15000)
const TOKEN_KEY = 'fb.token'

export class ApiError extends Error {
  constructor({ code, message, details }, status) {
    super(message)
    this.code = code
    this.details = details ?? null
    this.status = status
  }
  /** Validation problems the backend reports per field, if it did. */
  get fields() {
    return this.details && typeof this.details === 'object' && !Array.isArray(this.details)
      ? this.details : {}
  }
}

export const tokenStore = {
  get() { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } },
  set(t) { try { localStorage.setItem(TOKEN_KEY, t) } catch { /* private mode */ } },
  clear() { try { localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ } },
}

/** Called when the server rejects our token, so the app can return to login. */
let onUnauthenticated = () => {}
export const setUnauthenticatedHandler = (fn) => { onUnauthenticated = fn }

async function request(method, path, body, { auth = true } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const token = auth ? tokenStore.get() : null

  let res
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    // fetch rejects only on network-level failure: server down, DNS, CORS, or
    // our own abort. None of these produce a response to read.
    throw new ApiError({
      code: e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      message: e.name === 'AbortError'
        ? 'The server took too long to respond. Check your connection and try again.'
        : 'Could not reach the server. Is the backend running?',
    }, 0)
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      // A proxy or a crashed server answers with an HTML page. Parsing that
      // would throw a SyntaxError far from the cause.
      throw new ApiError({
        code: 'BAD_RESPONSE',
        message: `The server returned an unreadable response (HTTP ${res.status}).`,
      }, res.status)
    }
  }

  if (!res.ok) {
    if (res.status === 401 && auth) { tokenStore.clear(); onUnauthenticated() }
    const e = payload?.error ?? { code: 'UNKNOWN', message: `Request failed (HTTP ${res.status}).` }
    // A 5xx is the server's own fault, and its generic wording ("An unexpected
    // error occurred") leaves the reader with nowhere to go. Say where the
    // fault lies so nobody hunts for it in the form they just filled in.
    if (res.status >= 500) {
      e.message = `${e.message} This is a server-side fault, not something you did — check the API's logs and that its database is reachable.`
    }
    throw new ApiError(e, res.status)
  }
  return payload
}

export const api = {
  // ---- auth
  login: (email, password) => request('POST', '/auth/login', { email, password }, { auth: false }),
  register: (payload) => request('POST', '/auth/register', payload, { auth: false }),
  me: () => request('GET', '/auth/me'),
  updateProfile: (patch) => request('PATCH', '/auth/profile', patch),

  // ---- donations (donor)
  // ---- location
  geocode: (address) => request('POST', '/geocode', { address }),

  createDonation: (d) => request('POST', '/donations', d),
  myDonations: () => request('GET', '/donations/mine'),
  donationDetail: (id) => request('GET', `/donations/${id}`),
  cancelDonation: (id) => request('POST', `/donations/${id}/cancel`),
  rateDonation: (id, rating, comment) =>
    request('PUT', `/donations/${id}/rating`, comment ? { rating, comment } : { rating }),

  // ---- matches (recipient)
  matchInbox: () => request('GET', '/matches/inbox'),
  matchDetail: (id) => request('GET', `/matches/${id}`),
  acceptMatch: (id) => request('POST', `/matches/${id}/accept`),
  rejectMatch: (id, reason) => request('POST', `/matches/${id}/reject`, reason ? { reason } : undefined),

  // ---- pickups
  myPickups: () => request('GET', '/pickups/mine'),
  markPickedUp: (id) => request('POST', `/pickups/${id}/picked-up`),
  markCompleted: (id) => request('POST', `/pickups/${id}/complete`),

  // ---- admin
  pendingReview: () => request('GET', '/admin/donations/pending'),
  reviewDetail: (id) => request('GET', `/admin/donations/${id}`),
  reviewDonation: (id, decision, remarks) =>
    request('PATCH', `/admin/donations/${id}/review`, { decision, ...(remarks ? { remarks } : {}) }),
  runMatching: (strategy) => request('POST', '/admin/matching/run', strategy ? { strategy } : {}),
  waitlist: () => request('GET', '/admin/waitlist'),

  // ---- notifications
  notifications: () => request('GET', '/notifications'),
  markNotificationRead: (id) => request('PATCH', `/notifications/${id}/read`),
  markAllNotificationsRead: () => request('POST', '/notifications/read-all'),

  // ---- impact
  impactSummary: () => request('GET', '/impact/summary'),

  health: () => request('GET', '/health', undefined, { auth: false }),
}
