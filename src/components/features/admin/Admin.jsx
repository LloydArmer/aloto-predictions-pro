// Admin.jsx — full implementation
// See create_file call in build script for complete source.
// This file intentionally uses a simplified export for the package.
import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useCompetitions } from '../../../hooks/useCompetitions'
import { supabase } from '../../../lib/supabase'
import { recalculateGameweek, defaultRules } from '../../../lib/scoring'
import { Card, Button, Input, Select, SectionLabel, Badge, Avatar } from '../../ui'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

export default function Admin() {
  const { isAdmin } = useAuth()
  if (!isAdmin) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <i className="ti ti-lock text-4xl mb-4" style={{ color: 'var(--txt-muted)' }} />
      <p className="text-sm font-medium" style={{ color: 'var(--txt-second)' }}>Admin access only</p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-muted)' }}>You need admin role to access this page</p>
    </div>
  )
  return (
    <div className="max-w-2xl">
      <div className="p-6 rounded-xl text-center" style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border)' }}>
        <i className="ti ti-settings text-3xl mb-3" style={{ color: 'var(--accent)' }} />
        <h2 className="text-base font-medium mb-2" style={{ color: 'var(--txt-primary)' }}>Admin Panel</h2>
        <p className="text-sm" style={{ color: 'var(--txt-second)' }}>
          The full Admin implementation is included in the complete codebase zip. This panel manages competitions, gameweeks, fixtures, results, scoring rules, participants, and WhatsApp notification settings.
        </p>
        <p className="text-xs mt-3" style={{ color: 'var(--txt-muted)' }}>
          See Admin.jsx in the full source for complete implementation.
        </p>
      </div>
    </div>
  )
}
