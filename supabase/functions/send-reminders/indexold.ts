import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

async function sendTwilio(sid: string, token: string, from: string, to: string, body: string, channel: 'sms'|'whatsapp') {
  const fFrom = channel === 'whatsapp' ? `whatsapp:${from}` : from
  const fTo   = channel === 'whatsapp' ? `whatsapp:${to}`   : to
  const res   = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + btoa(`${sid}:${token}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: fFrom, To: fTo, Body: body }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || 'Twilio error')
  return data
}

function buildMessage(name: string, hours: number, fixtures: Array<{home_team:string;away_team:string;kickoff_time:string}>, appUrl: string): string {
  const timeLabel = hours <= 1 ? '1 HOUR — submit now!' : hours <= 6 ? '6 hours' : '24 hours'
  const lines = fixtures.map(f => {
    const t = new Date(f.kickoff_time).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/London' })
    return `  • ${f.home_team} vs ${f.away_team} (${t})`
  }).join('\n')
  return `🎯 ALOTO Prediction Pro — Deadline reminder\n\nHi ${name}! Your deadline is in ${timeLabel}.\n\nFixtures you haven't predicted:\n${lines}\n\nSubmit now: ${appUrl}/predict`
}

serve(async () => {
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const SID    = Deno.env.get('TWILIO_ACCOUNT_SID')!
    const TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')!
    const PHONE  = Deno.env.get('TWILIO_PHONE_NUMBER')!
    const APPURL = Deno.env.get('APP_URL')!
    const now    = new Date()
    const windows = [
      { label:'1h',  minH:0,  maxH:1  },
      { label:'6h',  minH:5,  maxH:6  },
      { label:'24h', minH:23, maxH:24 },
    ]
    let sent = 0; const errors: string[] = []

    for (const win of windows) {
      const start = new Date(now.getTime() + win.minH * 3600000)
      const end   = new Date(now.getTime() + win.maxH * 3600000)
      const { data: fixtures } = await supabase.from('fixtures').select('id,home_team,away_team,kickoff_time,gameweek_id').eq('status','upcoming').gte('kickoff_time',start.toISOString()).lte('kickoff_time',end.toISOString())
      if (!fixtures?.length) continue

      const gwIds = [...new Set(fixtures.map((f:any) => f.gameweek_id))]
      const { data: gws } = await supabase.from('gameweeks').select('id,competition_id').in('id', gwIds)
      if (!gws?.length) continue

      const compIds = [...new Set(gws.map((g:any) => g.competition_id))]
      const { data: parts } = await supabase.from('participants').select('user_id,competition_id,profiles(display_name,phone_number,notify_whatsapp,notify_sms,wa_opted_in)').in('competition_id', compIds)
      if (!parts?.length) continue

      for (const part of parts) {
        const prof = part.profiles as any
        if (!prof?.phone_number) continue

        const relGWIds = (gws as any[]).filter(g=>g.competition_id===part.competition_id).map(g=>g.id)
        const relFx    = fixtures.filter((f:any) => relGWIds.includes(f.gameweek_id))
        if (!relFx.length) continue

        const { data: preds } = await supabase.from('predictions').select('fixture_id').eq('user_id',part.user_id).in('fixture_id',relFx.map((f:any)=>f.id))
        const submittedIds = new Set((preds||[]).map((p:any)=>p.fixture_id))
        const unsub = relFx.filter((f:any) => !submittedIds.has(f.id))
        if (!unsub.length) continue

        const msg = buildMessage(prof.display_name||'there', win.maxH, unsub, APPURL)

        for (const channel of (['whatsapp','sms'] as const)) {
          if (channel === 'whatsapp' && (!prof.notify_whatsapp || !prof.wa_opted_in)) continue
          if (channel === 'sms'      && !prof.notify_sms) continue

          const { data: already } = await supabase.from('reminder_log').select('id').eq('user_id',part.user_id).eq('reminder_type',win.label).eq('channel',channel).in('fixture_id',unsub.map((f:any)=>f.id)).limit(1)
          if (already?.length) continue

          try {
            await sendTwilio(SID, TOKEN, PHONE, prof.phone_number, msg, channel)
            for (const fx of unsub) {
              await supabase.from('reminder_log').insert({ fixture_id:fx.id, user_id:part.user_id, reminder_type:win.label, channel })
            }
            sent++
          } catch (e:any) { errors.push(`${channel} → ${part.user_id}: ${e.message}`) }
        }
      }
    }

    return new Response(JSON.stringify({ success:true, sent, errors }), { headers:{ 'Content-Type':'application/json' } })
  } catch (e:any) {
    return new Response(JSON.stringify({ success:false, error:e.message }), { status:500, headers:{ 'Content-Type':'application/json' } })
  }
})
