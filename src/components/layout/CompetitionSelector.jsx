import { useCompetitions } from '../../hooks/useCompetitions'
import CompetitionIcon from '../ui/CompetitionIcon'

export default function CompetitionSelector({ value, onChange, excludeFormats = [] }) {
  const { competitions, loading } = useCompetitions()
  const visible = excludeFormats.length ? competitions.filter(c => !excludeFormats.includes(c.format)) : competitions

  if (loading) return (
    <div className="flex gap-2 mb-4">
      {[1,2,3].map(i => <div key={i} className="h-7 w-28 rounded-full animate-pulse" style={{ background: 'var(--bg-raised)' }} />)}
    </div>
  )

  return (
    <div className="flex gap-1.5 flex-wrap mb-5">
      {visible.map(c => (
        <button key={c.id} className={`pill ${value === c.id ? 'active' : ''}`} onClick={() => onChange(c.id)}
          style={{ gap: 7, paddingLeft: 6 }}>
          <CompetitionIcon format={c.format} emoji={c.emoji} />
          {c.name}
        </button>
      ))}
    </div>
  )
}
