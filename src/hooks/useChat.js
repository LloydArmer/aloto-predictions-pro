import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * One league's chat room.
 *
 * Holds the messages, keeps them current over Realtime, and exposes the four
 * things the screen does: send, edit, remove, report.
 *
 * Realtime rather than polling. The subscription carries the same row level
 * security as a normal read, so a message from someone you have blocked is
 * never delivered — not delivered and hidden. That distinction matters: a
 * client-side filter is one rendering bug away from showing the thing the
 * person asked never to see again.
 */

// How many messages to load on open. Enough to scroll back through a matchday
// without making the first paint wait on a long list.
const PAGE = 100

export function useChat(competitionId, userId) {
  const [messages, setMessages]   = useState([])
  const [people, setPeople]       = useState({})   // user_id -> profile
  const [loading, setLoading]     = useState(true)
  const [banned, setBanned]       = useState(false)
  const [error, setError]         = useState(null)

  // Realtime hands us raw rows with no author attached, so the roster is
  // fetched once and messages are matched against it. Kept in a ref as well as
  // state because the subscription callback closes over its first render.
  const peopleRef = useRef({})

  // ── Load the roster, the backlog, and whether this person is barred ───────
  useEffect(() => {
    if (!competitionId || !userId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      // Who is in this league. Needed for author names and avatars, and to
      // resolve @mentions when sending.
      const { data: parts } = await supabase
        .from('participants')
        .select('user_id, role, profiles:user_id (id, display_name, avatar_initials, badge_kit)')
        .eq('competition_id', competitionId)

      if (cancelled) return

      const roster = {}
      for (const p of parts || []) if (p.profiles) roster[p.profiles.id] = { ...p.profiles, role: p.role }
      peopleRef.current = roster
      setPeople(roster)

      // Am I barred from this room? Policy lets me read my own ban only, so a
      // row here always means me.
      const { count: banCount } = await supabase
        .from('chat_bans')
        .select('user_id', { count: 'exact', head: true })
        .eq('competition_id', competitionId)
        .eq('user_id', userId)
      if (!cancelled) setBanned((banCount ?? 0) > 0)

      // The backlog. Newest first from the database because that is the way
      // the index runs; reversed here because the screen reads oldest at the
      // top, like every other chat anyone has used.
      const { data, error: err } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('competition_id', competitionId)
        .order('created_at', { ascending: false })
        .limit(PAGE)

      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }

      setMessages((data || []).slice().reverse())
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [competitionId, userId])

  // ── Live updates ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!competitionId) return

    const channel = supabase
      .channel(`chat:${competitionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `competition_id=eq.${competitionId}`,
      }, payload => {
        setMessages(prev => {
          // The sender already added this optimistically, and a duplicate row
          // in a chat is worse than a slow one.
          if (prev.some(m => m.id === payload.new.id)) return prev
          return [...prev, payload.new]
        })
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'chat_messages',
        filter: `competition_id=eq.${competitionId}`,
      }, payload => {
        // Covers both an edit and a removal — a removal arrives as an update
        // with a blanked body, which is exactly what should be rendered.
        setMessages(prev => prev.map(m => (m.id === payload.new.id ? payload.new : m)))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [competitionId])

  // ── Sending ──────────────────────────────────────────────────────────────
  const send = useCallback(async (body) => {
    const text = (body || '').trim()
    if (!text) return { ok: false }

    const { data, error: err } = await supabase
      .from('chat_messages')
      .insert({
        competition_id: competitionId,
        user_id: userId,
        body: text,
        mentions: findMentions(text, peopleRef.current),
      })
      .select()
      .single()

    if (err) {
      // The filter raises a check violation with a sentence meant for the
      // person who typed it, so pass it straight through rather than replacing
      // it with something vaguer.
      return { ok: false, message: err.message }
    }

    // Show it immediately rather than waiting for the round trip back through
    // Realtime. The INSERT handler above de-duplicates when it arrives.
    setMessages(prev => (prev.some(m => m.id === data.id) ? prev : [...prev, data]))
    return { ok: true }
  }, [competitionId, userId])

  const edit = useCallback(async (id, body) => {
    const text = (body || '').trim()
    if (!text) return { ok: false }
    const { error: err } = await supabase
      .from('chat_messages')
      .update({ body: text, mentions: findMentions(text, peopleRef.current) })
      .eq('id', id)
    return err ? { ok: false, message: err.message } : { ok: true }
  }, [])

  const remove = useCallback(async (id) => {
    const { error: err } = await supabase.rpc('chat_delete_message', { p_message_id: id })
    return err ? { ok: false, message: err.message } : { ok: true }
  }, [])

  const report = useCallback(async (message, reason, note) => {
    const { error: err } = await supabase.from('chat_reports').insert({
      message_id: message.id,
      competition_id: competitionId,
      reporter_id: userId,
      reason,
      note: note || null,
    })
    // Reporting the same message twice is a unique violation, not a failure
    // worth alarming anyone about — they already told us.
    if (err && err.code === '23505') return { ok: true, already: true }
    return err ? { ok: false, message: err.message } : { ok: true }
  }, [competitionId, userId])

  const block = useCallback(async (blockedId) => {
    const { error: err } = await supabase
      .from('chat_blocks')
      .insert({ blocker_id: userId, blocked_id: blockedId })
    if (err && err.code !== '23505') return { ok: false, message: err.message }
    // Drop their messages from view at once. The policy stops any more
    // arriving, but the ones already on screen are ours to clear.
    setMessages(prev => prev.filter(m => m.user_id !== blockedId))
    return { ok: true }
  }, [userId])

  /** Mark the room read, which is what clears the badge. */
  const markRead = useCallback(async () => {
    if (!competitionId || !userId) return
    await supabase.from('chat_reads').upsert(
      { competition_id: competitionId, user_id: userId, last_read_at: new Date().toISOString() },
      { onConflict: 'competition_id,user_id' },
    )
  }, [competitionId, userId])

  return { messages, people, loading, banned, error, send, edit, remove, report, block, markRead }
}

/**
 * Which participants are @mentioned in this message.
 *
 * Matched against the roster rather than parsed as a word, because display
 * names contain spaces — "@Michael JNR" is one mention, not two. Longest names
 * first so "@Michael JNR" is not claimed by a "@Michael" who also plays.
 *
 * Stored on the message at send time. Resolving it later would break the
 * moment somebody renames themselves, which is exactly when a notification
 * going to the wrong person would be hardest to explain.
 */
export function findMentions(text, roster) {
  const lower = text.toLowerCase()
  const names = Object.values(roster || {})
    .filter(p => p.display_name)
    .sort((a, b) => b.display_name.length - a.display_name.length)

  const found = new Set()
  let remaining = lower
  for (const p of names) {
    const needle = '@' + p.display_name.toLowerCase()
    if (remaining.includes(needle)) {
      found.add(p.id)
      // Blank out what matched so a shorter name cannot match inside it.
      remaining = remaining.split(needle).join(' '.repeat(needle.length))
    }
  }
  return [...found]
}

/**
 * Unread counts for every room, in one call.
 *
 * One round trip on app open rather than one per competition, which is why
 * this is a function in the database rather than a query here.
 */
export function useUnreadChat(userId) {
  const [counts, setCounts] = useState({})

  const refresh = useCallback(async () => {
    if (!userId) { setCounts({}); return }
    const { data } = await supabase.rpc('chat_unread_counts')
    const next = {}
    for (const row of data || []) next[row.competition_id] = Number(row.unread) || 0
    setCounts(next)
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  // Any new message anywhere could change a badge. One subscription for the
  // whole account rather than one per room: the policies already restrict it
  // to leagues this person is in.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel('chat:unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, refresh)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, refresh])

  return [counts, refresh]
}
