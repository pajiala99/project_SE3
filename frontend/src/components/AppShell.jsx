import { NavLink, Outlet } from 'react-router-dom'
import { NotificationBell } from './NotificationBell.jsx'
import { useSession } from '../context/Session.jsx'
import { ROLE_LABEL } from '../lib/format.js'

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  list: 'M4 6h16M4 12h16M4 18h10',
  inbox: 'M4 4h16v12H7l-3 3V4z',
  box: 'M3 8l9-4 9 4v8l-9 4-9-4z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
}

/** Each role gets only the screens its account can actually use. */
const TABS_BY_ROLE = {
  DONOR: [
    { to: '/donate', label: 'Donate', icon: ICONS.plus },
    { to: '/donations', label: 'My donations', icon: ICONS.list },
  ],
  RECIPIENT: [
    { to: '/offers', label: 'Offers', icon: ICONS.inbox },
    { to: '/pickups', label: 'Collections', icon: ICONS.box },
  ],
  ADMIN: [
    { to: '/review', label: 'Review', icon: ICONS.shield },
    { to: '/impact', label: 'Impact', icon: ICONS.chart },
  ],
}

export function AppShell() {
  const { user, signOut } = useSession()
  const tabs = TABS_BY_ROLE[user?.role] ?? []

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">FB</span>
          FoodBridge
        </span>

        <span className="who">
          <span className="who-name">{user?.name}</span>
          <span className="who-role">{ROLE_LABEL[user?.role] ?? user?.role}</span>
        </span>

        <NotificationBell />
        <button className="btn-sm" onClick={signOut}>Sign out</button>
      </header>

      <nav className="tabs" aria-label="Main">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} className="tab">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={t.icon} />
            </svg>
            {t.label}
          </NavLink>
        ))}
      </nav>

      <main className="main"><Outlet /></main>
    </div>
  )
}
