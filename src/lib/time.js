// Converts a "YYYY-MM-DDTHH:mm" wall-clock value (as typed into a
// <input type="datetime-local">) into the correct UTC ISO string,
// treating that value as UK local time — automatically accounting for
// BST/GMT regardless of what timezone the admin's own computer is set to.
export function ukLocalToISO(dateTimeLocal) {
  if (!dateTimeLocal) return null
  const naiveUTC = new Date(dateTimeLocal + 'Z')
  const offset1 = ukOffsetMinutes(naiveUTC)
  const pass1 = new Date(naiveUTC.getTime() - offset1 * 60000)
  const offset2 = ukOffsetMinutes(pass1) // second pass handles the DST-boundary edge case
  return new Date(naiveUTC.getTime() - offset2 * 60000).toISOString()
}

function ukOffsetMinutes(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map(p => [p.type, p.value])
  )
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour === '24' ? 0 : parts.hour, parts.minute, parts.second)
  return (asUTC - date.getTime()) / 60000
}

// Formats a stored UTC timestamp back into UK local time for display —
// so every viewer sees the same kickoff time regardless of their own
// device's timezone setting.
export function formatUK(isoString, opts = {}) {
  return new Date(isoString).toLocaleString('en-GB', {
    timeZone: 'Europe/London', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, ...opts,
  })
}

// For pre-filling a <input type="datetime-local"> with an existing UTC
// timestamp, shown correctly in UK local time.
export function isoToUkLocalInput(isoString) {
  if (!isoString) return ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(isoString)).map(p => [p.type, p.value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`
}
