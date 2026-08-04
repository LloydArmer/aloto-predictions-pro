import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { AlotoMark } from '../ui/AlotoLogo'
import toast from 'react-hot-toast'

const NAV = [
  { to: '/',             label: 'Dashboard',    icon: 'ti-layout-dashboard' },
  { to: '/predict',      label: 'Predict',      icon: 'ti-pencil' },
  { to: '/table',        label: 'Table',        icon: 'ti-list-numbers' },
  { to: '/leaderboards', label: 'Leaderboards', icon: 'ti-medal' },
  { to: '/bracket',      label: 'Bracket',      icon: 'ti-tournament' },
  { to: '/settings',     label: 'Settings',     icon: 'ti-settings-2' },
]

export default function AppLayout({ children }) {
  const { profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  async function handleSignOut() {
    try { await signOut(); navigate('/login') }
    catch { toast.error('Sign out failed') }
  }

  const initials = profile?.display_name
    ? profile.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2)
    : '?'

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-40"
        style={{ background: 'var(--bg-surface)', borderBottom: '0.5px solid var(--border)' }}>
        <div className="max-w-5xl mx-auto px-4 flex items-center" style={{ height: 52 }}>

          {/* Brand mark + wordmark */}
          <div className="flex items-center gap-2.5 mr-5 flex-shrink-0">
            <AlotoMark size={26} />
            <div className="flex flex-col leading-none">
              <span className="font-black text-sm tracking-widest" style={{ color: '#f0f2f8', letterSpacing: '1.5px' }}>
                ALOTO
              </span>
              <span style={{ color: 'var(--accent)', fontSize: 9, letterSpacing: '1.8px', fontWeight: 600 }}>
                PREDICTION PRO
              </span>
            </div>
          </div>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-0.5 flex-1">
            {NAV.map(item => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${isActive ? 'font-medium' : ''}`
                }
                style={({ isActive }) => ({
                  color: isActive ? 'var(--accent)' : 'var(--txt-second)',
                  background: isActive ? 'var(--accent-dim)' : 'transparent',
                })}>
                <i className={`ti ${item.icon} text-sm`} aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
            {isAdmin && (
              <NavLink to="/admin"
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${isActive ? 'font-medium' : ''}`
                }
                style={({ isActive }) => ({
                  color: isActive ? 'var(--amber)' : 'var(--txt-second)',
                  background: isActive ? 'var(--amber-dim)' : 'transparent',
                })}>
                <i className="ti ti-shield text-sm" aria-hidden="true" />
                Admin
              </NavLink>
            )}
          </div>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-2">
            {isAdmin && <span className="badge badge-admin hidden md:inline-flex">Admin</span>}
            <div className="avatar w-7 h-7 text-xs">{initials}</div>
            <span className="hidden md:block text-xs" style={{ color: 'var(--txt-second)' }}>
              {profile?.display_name || 'Player'}
            </span>
            <button onClick={handleSignOut} className="btn btn-ghost btn-sm hidden md:inline-flex" title="Sign out">
              <i className="ti ti-logout text-sm" aria-hidden="true" />
            </button>
            <button className="btn btn-ghost btn-sm md:hidden" onClick={() => setOpen(o => !o)} aria-label="Menu">
              <i className={`ti ${open ? 'ti-x' : 'ti-menu-2'} text-sm`} />
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {open && (
          <div className="md:hidden px-4 pb-3 flex flex-col gap-1"
            style={{ borderTop: '0.5px solid var(--border)' }}>
            {NAV.map(item => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-md text-sm ${isActive ? 'font-medium' : ''}`
                }
                style={({ isActive }) => ({
                  color: isActive ? 'var(--accent)' : 'var(--txt-second)',
                  background: isActive ? 'var(--accent-dim)' : 'transparent',
                })}>
                <i className={`ti ${item.icon}`} aria-hidden="true" />{item.label}
              </NavLink>
            ))}
            {isAdmin && (
              <NavLink to="/admin" onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm"
                style={{ color: 'var(--amber)' }}>
                <i className="ti ti-shield" />Admin
              </NavLink>
            )}
            <button onClick={handleSignOut}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left"
              style={{ color: 'var(--txt-second)' }}>
              <i className="ti ti-logout" />Sign out
            </button>
          </div>
        )}
      </nav>

      {/* ── Page content ── */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {children}
      </main>

      {/* ── Footer ── */}
      <footer className="max-w-5xl mx-auto px-4 pb-8">
        <div className="flex items-center justify-between pt-4"
          style={{ borderTop: '0.5px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <AlotoMark size={16} />
            <span className="text-xs font-black tracking-widest" style={{ color: 'var(--txt-muted)', letterSpacing: '1.5px' }}>
              ALOTO
            </span>
          </div>
          <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>
            ALOTO Prediction Pro · Built by ALOTO
          </span>
        </div>
      </footer>
    </div>
  )
}
