import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../context/Session.jsx'
import { Field, Segmented } from '../components/Field.jsx'
import { LocationField } from '../components/LocationField.jsx'
import { DONOR_TYPES, ORGANIZATION_TYPES, FOOD_TYPES } from '../lib/format.js'

/**
 * Registration.
 *
 * The backend takes a different profile block depending on the role, so the
 * form asks for one thing first — who you are — and only then shows the fields
 * that role actually needs. A recipient's capacity, radius and location are
 * hard constraints the matcher filters on, so each is labelled with what it
 * will be used for rather than left to guesswork. So are the two food lists:
 * what the organisation accepts, and what it must never be sent.
 */

/** Quick-fill only. The address is still resolved by the server. */
const NEARBY = [
  'Thapar Institute, Patiala',
  'Model Town, Patiala',
  'Urban Estate, Patiala',
  'Leela Bhawan, Patiala',
]

export function Register() {
  const { signUp } = useSession()
  const [role, setRole] = useState('DONOR')
  const [f, setF] = useState({
    name: '', email: '', password: '', phone: '',
    donorType: 'MESS',
    organizationType: 'SHELTER', servingCapacity: '', serviceRadiusKm: 8,
    foodPreferences: [], dietaryRestrictions: [],
  })
  const [location, setLocation] = useState(null)
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }))

  // A food type cannot be both accepted and forbidden; restricting one drops it
  // from the accepted list, so the pair can never contradict each other.
  const setRestrictions = (next) => setF((p) => ({
    ...p,
    dietaryRestrictions: next,
    foodPreferences: p.foodPreferences.filter((v) => !next.includes(v)),
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const onSubmit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const base = {
      name: f.name.trim(), email: f.email.trim(), password: f.password, role,
      ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
    }
    if (role === 'RECIPIENT' && !location) {
      setError({ message: 'Find your address before continuing, so the point can be confirmed.' })
      setBusy(false)
      return
    }
    const payload = role === 'DONOR'
      ? { ...base, donorType: f.donorType }
      : {
          ...base,
          organizationType: f.organizationType,
          servingCapacity: Number(f.servingCapacity),
          serviceRadiusKm: Number(f.serviceRadiusKm),
          foodPreferences: f.foodPreferences,
          dietaryRestrictions: f.dietaryRestrictions,
          address: location.address,
          latitude: location.latitude,
          longitude: location.longitude,
        }
    try { await signUp(payload) }
    catch (err) { setError(err) }
    finally { setBusy(false) }
  }

  const fieldErr = (k) => error?.fields?.[k]

  return (
    <div className="auth-card">
      <div className="page-head">
        <h1>Create an account</h1>
        <p className="muted">Donors post surplus food. Organisations receive it.</p>
      </div>

      {error && !Object.keys(error.fields ?? {}).length && (
        <div className="banner" data-kind="error" role="alert" style={{ marginBottom: 16 }}>{error.message}</div>
      )}

      <form className="stack-lg" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label>I am registering as</label>
          <Segmented name="Account type" value={role} onChange={setRole}
            options={[{ value: 'DONOR', label: 'A donor' }, { value: 'RECIPIENT', label: 'An organisation' }]} />
        </div>

        <Field label={role === 'DONOR' ? 'Your name or business' : 'Organisation name'}
          htmlFor="name" error={fieldErr('name')}>
          {(p) => <input {...p} value={f.name} onChange={(e) => set('name')(e.target.value)}
            placeholder={role === 'DONOR' ? 'Hostel J Mess' : 'Seva Sadan Shelter'} />}
        </Field>

        <Field label="Email" htmlFor="email" error={fieldErr('email')}>
          {(p) => <input {...p} type="email" autoComplete="email" value={f.email}
            onChange={(e) => set('email')(e.target.value)} />}
        </Field>

        <Field label="Password" htmlFor="password" hint="At least 8 characters." error={fieldErr('password')}>
          {(p) => <input {...p} type="password" autoComplete="new-password" value={f.password}
            onChange={(e) => set('password')(e.target.value)} />}
        </Field>

        <Field label="Phone" htmlFor="phone" hint="Shared with the other party only after a match is accepted.">
          {(p) => <input {...p} type="tel" inputMode="tel" autoComplete="tel" value={f.phone}
            onChange={(e) => set('phone')(e.target.value)} />}
        </Field>

        {role === 'DONOR' ? (
          <Field label="What kind of donor are you?" htmlFor="donorType">
            {(p) => (
              <select {...p} value={f.donorType} onChange={(e) => set('donorType')(e.target.value)}>
                {DONOR_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
          </Field>
        ) : (
          <>
            <Field label="Organisation type" htmlFor="organizationType">
              {(p) => (
                <select {...p} value={f.organizationType} onChange={(e) => set('organizationType')(e.target.value)}>
                  {ORGANIZATION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
            </Field>

            <Field label="Food you accept"
              hint="Leave all unselected to be offered every kind of food. Selecting any
                    means you are offered only those.">
              {() => (
                <Segmented name="Food you accept" multiple
                  value={f.foodPreferences} onChange={set('foodPreferences')}
                  options={FOOD_TYPES
                    .filter(([v]) => !f.dietaryRestrictions.includes(v))
                    .map(([value, label]) => ({ value, label }))} />
              )}
            </Field>

            <Field label="Food you can never accept"
              hint="A dietary restriction. These are never offered to you, whatever else matches.">
              {() => (
                <Segmented name="Food you can never accept" multiple
                  value={f.dietaryRestrictions} onChange={setRestrictions}
                  options={FOOD_TYPES.map(([value, label]) => ({ value, label }))} />
              )}
            </Field>

            <Field label="Servings you can take per day" htmlFor="servingCapacity"
              hint="Donations larger than your remaining capacity are not offered to you."
              error={fieldErr('servingCapacity')}>
              {(p) => <input {...p} type="number" inputMode="numeric" min="1" step="1"
                value={f.servingCapacity} onChange={(e) => set('servingCapacity')(e.target.value)} placeholder="120" />}
            </Field>

            <Field label="How far will you travel?" htmlFor="serviceRadiusKm"
              hint="Donations outside this radius are never offered to you.">
              {(p) => (
                <div className="row">
                  <input {...p} type="range" min="1" max="25" step="1" style={{ flex: 1 }}
                    value={f.serviceRadiusKm} onChange={(e) => set('serviceRadiusKm')(e.target.value)} />
                  <output style={{ minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {f.serviceRadiusKm} km
                  </output>
                </div>
              )}
            </Field>

            <LocationField
              label="Where are you based?"
              hint="Type your address and press Find. Distance to every donation is measured from this point."
              shortcuts={NEARBY}
              value={location}
              onChange={setLocation}
              error={fieldErr('latitude') ?? fieldErr('address')} />
          </>
        )}

        <button type="submit" className="btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="muted" style={{ textAlign: 'center', marginTop: 20 }}>
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </div>
  )
}
