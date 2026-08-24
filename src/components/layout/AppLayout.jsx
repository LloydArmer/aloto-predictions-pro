import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useCompetitions } from '../../hooks/useCompetitions'
import { useSelectedCompetition } from '../../hooks/useSelectedCompetition'
import toast from 'react-hot-toast'

const NAV_BASE = [
  { to: '/',             label: 'Dashboard',    icon: 'ti-layout-dashboard' },
  { to: '/predict',      label: 'Predict',      icon: 'ti-pencil' },
  // Table, Cup and Season results merged into one destination. Four tabs on a
  // 390px screen give noticeably wider targets than five, and no truncation.
  { to: '/standings',    label: 'Standings',    icon: 'ti-list-numbers' },
  { to: '/settings',     label: 'Settings',     icon: 'ti-settings-2' },
]

export default function AppLayout({ children }) {
  const { profile, isAdmin, signOut } = useAuth()
  const { competitions } = useCompetitions()
  const [selectedComp] = useSelectedCompetition(competitions)
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const compFormat = competitions.find(c => c.id === selectedComp)?.format
  const showBracket = competitions.some(c => c.format !== 'league')
  const showTable   = compFormat !== 'knockout'
  const NAV = NAV_BASE
    .filter(item => item.to !== '/bracket' || showBracket)
    .filter(item => item.to !== '/table'   || showTable)

  async function handleSignOut() {
    try { await signOut(); navigate('/login') }
    catch { toast.error('Sign out failed') }
  }

  const initials = profile?.display_name
    ? profile.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2)
    : '?'

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>

      {/* ── Top nav bar ── */}
      <nav className="sticky top-0 z-40"
        style={{ background: 'var(--bg-surface)', borderBottom: '0.5px solid var(--border)' }}>
        {/* 46px on mobile rather than 52 — with a tab bar at the bottom too,
            every pixel of chrome is one less of content. */}
        <div className="max-w-5xl mx-auto px-4 flex items-center h-[46px] md:h-[52px]">

          {/* Brand */}
          <div className="flex items-center gap-2.5 mr-5 flex-shrink-0">
            <img src="/icon.png" alt="ALOTO Prediction Pro" width={26} height={26} style={{ borderRadius: 6 }} />
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
                {item.label === 'Cup' ? 'Cup Competitions' : item.label}
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

          {/* Right side — desktop only */}
          <div className="ml-auto flex items-center gap-2">
            {isAdmin && <span className="badge badge-admin hidden md:inline-flex">Admin</span>}
            <div className="avatar w-7 h-7 text-xs">{initials}</div>
            <span className="hidden md:block text-xs" style={{ color: 'var(--txt-second)' }}>
              {profile?.display_name || 'Player'}
            </span>
            <button onClick={handleSignOut} className="btn btn-ghost btn-sm hidden md:inline-flex" title="Sign out">
              <i className="ti ti-logout text-sm" aria-hidden="true" />
            </button>
            {/* Mobile: show admin link + sign out in a tiny menu */}
            {(isAdmin) && (
              <div className="md:hidden relative">
                <button className="btn btn-ghost btn-sm" onClick={() => setMenuOpen(o => !o)}>
                  <i className={`ti ${menuOpen ? 'ti-x' : 'ti-dots-vertical'} text-sm`} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-9 rounded-lg shadow-lg py-1 z-50 min-w-36"
                    style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-med)' }}>
                    {isAdmin && (
                      <NavLink to="/admin" onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 text-sm"
                        style={{ color: 'var(--amber)' }}>
                        <i className="ti ti-shield text-sm" />Admin
                      </NavLink>
                    )}
                    <button onClick={handleSignOut}
                      className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left"
                      style={{ color: 'var(--txt-second)' }}>
                      <i className="ti ti-logout text-sm" />Sign out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ── Page content — extra bottom padding on mobile for the tab bar ── */}
      {/* Bottom padding is computed from --tab-bar-h rather than guessed, so
          content clears the bar exactly and no dead band is left below it. */}
      <main
        className="max-w-5xl mx-auto px-4 pt-4 md:pt-6 md:pb-6"
        style={{ paddingBottom: 'calc(var(--tab-bar-h) + env(safe-area-inset-bottom) + 12px)' }}
      >
        {children}
      </main>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 tab-bar">
        {NAV.map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}
            className={({ isActive }) => `tab-item${isActive ? ' active' : ''}`}>
            <i className={`ti ${item.icon}`} aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* ── Footer — desktop only ── */}
      <footer className="hidden md:block max-w-5xl mx-auto px-4 pb-8">
        <div className="flex items-center justify-between pt-4"
          style={{ borderTop: '0.5px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <img src="/icon.png" alt="ALOTO Prediction Pro" width={16} height={16} style={{ borderRadius: 4 }} />
          </div>
          <span className="text-xs" style={{ color: 'var(--txt-muted)' }}>
            ALOTO Prediction Pro · Built by ALOTO
          </span>
        </div>
      </footer>
    </div>
  )
}
