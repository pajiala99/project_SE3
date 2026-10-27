import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { SessionProvider, useSession } from './context/Session.jsx'
import { AppShell } from './components/AppShell.jsx'
import { Login } from './pages/Login.jsx'
import { Register } from './pages/Register.jsx'
import { DonorNew } from './pages/DonorNew.jsx'
import { DonorDonations } from './pages/DonorDonations.jsx'
import { DonationDetail } from './pages/DonationDetail.jsx'
import { MatchInbox } from './pages/MatchInbox.jsx'
import { Pickups } from './pages/Pickups.jsx'
import { AdminReview } from './pages/AdminReview.jsx'

// The charting library is most of the bundle and only the impact screen needs
// it, so the donor path — the one that has to work on a cheap phone — stays small.
const ImpactDashboard = lazy(() =>
  import('./pages/ImpactDashboard.jsx').then((m) => ({ default: m.ImpactDashboard }))
)

const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '')

export function App() {
  return (
    <BrowserRouter basename={BASENAME}>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
          <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />

          <Route element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route index element={<Home />} />
            <Route path="/donate" element={<RequireRole role="DONOR"><DonorNew /></RequireRole>} />
            <Route path="/donations" element={<RequireRole role="DONOR"><DonorDonations /></RequireRole>} />
            <Route path="/donations/:id" element={<DonationDetail />} />
            <Route path="/offers" element={<RequireRole role="RECIPIENT"><MatchInbox /></RequireRole>} />
            <Route path="/pickups" element={<Pickups />} />
            <Route path="/review" element={<RequireRole role="ADMIN"><AdminReview /></RequireRole>} />
            <Route path="/impact" element={
              <Suspense fallback={<div className="skeleton" style={{ height: 300 }} aria-busy="true" aria-label="Loading dashboard" />}>
                <ImpactDashboard />
              </Suspense>
            } />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  )
}

/** Where each role starts. */
function Home() {
  const { user } = useSession()
  const to = { DONOR: '/donate', RECIPIENT: '/offers', ADMIN: '/review' }[user?.role] ?? '/login'
  return <Navigate to={to} replace />
}

function RequireAuth({ children }) {
  const { user, booting } = useSession()
  const location = useLocation()
  if (booting) return <div className="skeleton" style={{ height: 200, margin: 16 }} aria-busy="true" />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return children
}

/** Signing in again while already signed in just lands you on your own screen. */
function PublicOnly({ children }) {
  const { user, booting } = useSession()
  if (booting) return <div className="skeleton" style={{ height: 200, margin: 16 }} aria-busy="true" />
  if (user) return <Navigate to="/" replace />
  return <div className="auth-wrap">{children}</div>
}

/**
 * A screen the account's role cannot use is not an error to explain — it simply
 * does not exist for them, so send them to the one that does.
 */
function RequireRole({ role, children }) {
  const { user } = useSession()
  if (user?.role !== role) return <Navigate to="/" replace />
  return children
}

function NotFound() {
  return (
    <div className="empty">
      <h1>Page not found</h1>
      <p><a href="/">Back to the start</a></p>
    </div>
  )
}
