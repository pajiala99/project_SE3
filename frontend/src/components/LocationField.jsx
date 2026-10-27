import { useState } from 'react'
import { api } from '../api/client.js'
import { Field } from './Field.jsx'

/**
 * Pick a place by typing its address.
 *
 * Matching is spatial, so every donation and every organisation has to end up
 * as a latitude and longitude. Asking a user for those directly is unreasonable,
 * so this asks for an address and has the server resolve it: POST /geocode
 * returns the point and says whether it came from the cache or the provider.
 *
 * The resolved point is shown before anything is submitted, because an address
 * that silently lands in the wrong town would quietly ruin every match that
 * followed. Nothing is submitted until the user has seen where it landed.
 *
 * The shortcuts are a convenience for the Patiala demo, not the mechanism —
 * they fill the text box, and the address is still resolved by the server.
 */
export function LocationField({
  label = 'Where is it?',
  hint,
  shortcuts = [],
  value,
  onChange,
  error,
}) {
  const [address, setAddress] = useState(value?.address ?? '')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(null)

  const locate = async (query) => {
    const q = (query ?? address).trim()
    if (!q) return
    setBusy(true); setFailed(null); onChange(null)
    try {
      const r = await api.geocode(q)
      onChange({ address: r.address, latitude: r.latitude, longitude: r.longitude, source: r.source })
    } catch (err) {
      setFailed(err.message || 'That address could not be located.')
    } finally {
      setBusy(false)
    }
  }

  // Editing the text invalidates whatever was resolved from the previous text,
  // so a stale point can never be submitted under a new address.
  const edit = (next) => { setAddress(next); setFailed(null); if (value) onChange(null) }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <Field label={label} htmlFor="address" hint={hint} error={error ?? failed}>
        {(p) => (
          <div className="row" style={{ gap: 8 }}>
            <input {...p} type="text" style={{ flex: 1 }} value={address} autoComplete="street-address"
              placeholder="e.g. Thapar Institute, Patiala"
              onChange={(e) => edit(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); locate() } }} />
            <button type="button" className="btn-sm" onClick={() => locate()} disabled={busy || !address.trim()}>
              {busy ? 'Locating…' : 'Find'}
            </button>
          </div>
        )}
      </Field>

      {shortcuts.length > 0 && !value && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="hint">Nearby:</span>
          {shortcuts.map((s) => (
            <button key={s} type="button" className="btn-sm"
              onClick={() => { setAddress(s); locate(s) }}>{s}</button>
          ))}
        </div>
      )}

      {value && (
        <div className="banner" data-kind="ok" role="status">
          Located <strong>{value.address}</strong> at{' '}
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {value.latitude.toFixed(4)}, {value.longitude.toFixed(4)}
          </span>
          {value.source === 'CACHE' && <span className="hint"> · from the address cache</span>}
          {value.source === 'GEOCODED' && <span className="hint"> · looked up just now</span>}
        </div>
      )}
    </div>
  )
}
