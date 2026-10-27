import { Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useApi, useTicker } from '../hooks/useApi.js'
import { statusLabel, foodLabel, relative, isUrgent } from '../lib/format.js'

const LIVE = ['PENDING_REVIEW', 'POSTED', 'MATCHED', 'PICKED_UP']

export function DonorDonations() {
  const { data, loading, error } = useApi(() => api.myDonations(), [])
  useTicker(30000) // keeps "expires in …" honest without refetching

  if (loading) return <div className="stack" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}</div>
  if (error) return <div className="banner" data-kind="error" role="alert">{error.message}</div>

  const items = data?.donations ?? []

  return (
    <>
      <div className="page-head">
        <h1>My donations</h1>
        <p className="muted">{items.length} total</p>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <p>No donations yet.</p>
          <p><Link to="/donate">Post your first one</Link></p>
        </div>
      ) : (
        <div className="stack">{items.map((d) => <Row key={d.donation_id} d={d} />)}</div>
      )}
    </>
  )
}

function Row({ d }) {
  const live = LIVE.includes(d.status)
  const urgent = live && isUrgent(d.expires_at)
  return (
    <Link to={`/donations/${d.donation_id}`} className="card stack"
      style={{ textDecoration: 'none', color: 'inherit', gap: 8 }}>
      <div className="spread">
        <strong>{d.quantity_servings} servings</strong>
        <span className="pill" data-status={d.status}>{statusLabel(d.status)}</span>
      </div>
      {d.description && <div className="muted">{d.description}</div>}
      <div className="row" style={{ gap: 8 }}>
        <span className="muted">{foodLabel(d.food_type)}</span>
        {d.pickup_address && <>
          <span className="muted" aria-hidden="true">·</span>
          <span className="muted">{d.pickup_address}</span>
        </>}
      </div>
      {live && (
        <span className="pill" data-urgent={urgent} style={{ alignSelf: 'flex-start' }}>
          {urgent ? 'Collect ' : 'Expires '}{relative(d.expires_at)}
        </span>
      )}
    </Link>
  )
}
