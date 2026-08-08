import { forwardRef } from 'react'

export function Button({ children, variant = 'default', size = 'md', className = '', ...props }) {
  const variants = { default: '', primary: 'btn-primary', danger: 'btn-danger', ghost: 'btn-ghost' }
  const sizes    = { md: '', sm: 'btn-sm' }
  return (
    <button className={`btn ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Badge({ children, variant = 'upcoming', className = '' }) {
  return <span className={`badge badge-${variant} ${className}`}>{children}</span>
}

export function Card({ children, className = '', raised = false, ...props }) {
  return (
    <div className={`${raised ? 'card-raised' : 'card'} ${className}`} {...props}>
      {children}
    </div>
  )
}

export const Input = forwardRef(function Input({ className = '', ...props }, ref) {
  return <input ref={ref} className={`input ${className}`} {...props} />
})

export function Select({ children, className = '', ...props }) {
  return <select className={`select ${className}`} {...props}>{children}</select>
}

export function Avatar({ initials, size = 'sm' }) {
  const sizes = { sm: 'w-7 h-7 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-11 h-11 text-base' }
  return <div className={`avatar ${sizes[size]}`}>{initials || '?'}</div>
}

export function SectionLabel({ children, className = '' }) {
  return <p className={`section-label mb-2 ${className}`}>{children}</p>
}

export function StatCard({ label, value, sub, accentColor }) {
  return (
    <div className="stat-card" style={{ minWidth: 0 }}>
      <p className="text-xs mb-1" style={{ color: 'var(--txt-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</p>
      <p className="text-2xl font-medium" style={{ color: accentColor || 'var(--txt-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--txt-second)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</p>}
    </div>
  )
}

export function LiveDot() {
  return <span className="live-dot" aria-label="Live" />
}

export function Divider({ className = '' }) {
  return <div className={`h-px w-full ${className}`} style={{ background: 'var(--border)' }} />
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center px-4">
      {icon && <i className={`ti ${icon} text-4xl mb-4`} style={{ color: 'var(--txt-muted)' }} aria-hidden="true" />}
      <p className="text-sm font-medium mb-1" style={{ color: 'var(--txt-second)' }}>{title}</p>
      {description && <p className="text-xs mb-4" style={{ color: 'var(--txt-muted)' }}>{description}</p>}
      {action}
    </div>
  )
}

export function Spinner({ size = 'md' }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }
  return (
    <div className={`${sizes[size]} border-2 rounded-full animate-spin`}
      style={{ borderColor: 'var(--border-med)', borderTopColor: 'var(--accent)' }} />
  )
}

export function FormPip({ outcome }) {
  const o = (outcome || '').toUpperCase()
  if (o === 'W') return <span className="pip pip-w">W</span>
  if (o === 'D') return <span className="pip pip-d">D</span>
  return <span className="pip pip-l">L</span>
}
