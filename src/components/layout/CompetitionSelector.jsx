import { useCompetitions } from '../../hooks/useCompetitions'

export default function CompetitionSelector({ value, onChange }) {
  const { competitions, loading } = useCompetitions()

  if (loading) return (
    <div className="flex gap-2 mb-4">
      {[1,2,3].map(i => <div key={i} className="h-7 w-28 rounded-full animate-pulse" style={{ background: 'var(--bg-raised)' }} />)}
    </div>
  )

  return (
    <div className="flex gap-1.5 flex-wrap mb-5">
      {competitions.map(c => (
        <button key={c.id} className={`pill ${value === c.id ? 'active' : ''}`} onClick={() => onChange(c.id)}>
          {c.emoji || '⚽'} {c.name}
        </button>
      ))}
    </div>
  )
}
