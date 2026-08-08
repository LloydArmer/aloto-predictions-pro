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

serve(async (req) => {
  try {
    const { phone, name, channel, competitionName, inviterName } = await req.json()
    if (!phone || !channel) {
      return new Response(JSON.stringify({ success: false, error: 'phone and channel are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const SID    = Deno.env.get('TWILIO_ACCOUNT_SID')!
    const TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')!
    const PHONE  = Deno.env.get('TWILIO_PHONE_NUMBER')!
    const APPURL = Deno.env.get('APP_URL')!

    const greeting = name ? `Hi ${name}!` : 'Hi!'
    const who = inviterName ? `${inviterName} has` : 'You\'ve'
    const what = competitionName ? `invited you to join "${competitionName}" on ALOTO Prediction Pro` : 'invited you to join ALOTO Prediction Pro'
    const message = `🎯 ${greeting} ${who} ${what}. Sign up here: ${APPURL}/signup`

    const data = await sendTwilio(SID, TOKEN, PHONE, phone, message, channel)

    return new Response(JSON.stringify({ success: true, sid: data.sid }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
