import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../context/Session.jsx'
import { Field } from '../components/Field.jsx'

export function Login() {
  const { signIn } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const onSubmit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await signIn(email.trim(), password) }
    catch (err) { setError(err) }
    finally { setBusy(false) }
  }

  return (
    <div className="auth-card">
      <div className="page-head">
        <h1>Sign in</h1>
        <p className="muted">FoodBridge — surplus food redistribution</p>
      </div>

      {error && <div className="banner" data-kind="error" role="alert" style={{ marginBottom: 16 }}>{error.message}</div>}

      <form className="stack-lg" onSubmit={onSubmit} noValidate>
        <Field label="Email" htmlFor="email">
          {(p) => <input {...p} type="email" value={email} autoComplete="email"
            onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />}
        </Field>

        <Field label="Password" htmlFor="password">
          {(p) => <input {...p} type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} />}
        </Field>

        <button type="submit" className="btn-primary btn-block" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="muted" style={{ textAlign: 'center', marginTop: 20 }}>
        No account yet? <Link to="/register">Register an organisation or a donor</Link>
      </p>
    </div>
  )
}
