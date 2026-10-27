import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { relative } from '../lib/format.js'

const POLL_MS = 20000

/** Icon per backend NotificationType (backend/src/domain/enums.ts). */
const ICON = {
  ADMIN_REVIEW_REQUIRED: '🛡️', DONATION_APPROVED: '✅', DONATION_REJECTED: '🚫',
  NEW_ELIGIBLE_DONATION: '📥', MATCH_CREATED: '🤝', MATCH_ACCEPTED: '✅',
  MATCH_REJECTED: '↩️', DONOR_AWAITING_MATCH: '⏳', PICKUP_SCHEDULED: '📦',
  PICKUP_PICKED_UP: '🚚', REDISTRIBUTION_COMPLETED: '🎉', MATCH_EXPIRED: '⌛',
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const wrapRef = useRef(null)

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const r = await api.notifications()
        if (alive) { setItems(r.notifications ?? []); setUnread(Number(r.unread ?? 0)) }
      } catch { /* a failed poll is not worth interrupting the user for */ }
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // Close on outside click and on Escape — a panel you cannot dismiss is a trap.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const markAllRead = async () => {
    try {
      await api.markAllNotificationsRead()
      setItems((xs) => xs.map((n) => ({ ...n, read: true })))
      setUnread(0)
    } catch { /* leave the badge as it was */ }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button className="bell" onClick={() => setOpen((o) => !o)}
        aria-expanded={open} aria-haspopup="true"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" strokeLinecap="round" />
        </svg>
        {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="spread" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
            <strong style={{ fontSize: '.9375rem' }}>Notifications</strong>
            {unread > 0 && <button className="btn-sm" onClick={markAllRead}>Mark all read</button>}
          </div>
          {items.length === 0
            ? <p className="empty">Nothing yet.</p>
            : items.map((n) => (
                <div key={n.notification_id} className="notif" data-unread={!n.read}>
                  <span aria-hidden="true">{ICON[n.type] ?? '•'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '.9375rem' }}>{n.message}</div>
                    <div className="muted" style={{ fontSize: '.75rem' }}>{relative(n.sent_at)}</div>
                  </div>
                  {!n.read && <span className="notif-dot" aria-label="unread" />}
                </div>
              ))}
        </div>
      )}
    </div>
  )
}
