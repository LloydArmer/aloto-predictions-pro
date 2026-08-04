# ALOTO Prediction Pro

**Built by ALOTO**

A full-stack football predictions app with league tables, weekly & monthly leaderboards, knockout brackets, and WhatsApp sharing. Dark-themed, mobile-responsive, deployed to Netlify with Supabase as the backend.

---

## Logo & brand

The approved ALOTO Prediction Pro logo is included in `public/`:

| File | Use |
|---|---|
| `public/logo.png` | Full horizontal wordmark (1400×380, high resolution) |
| `public/logo-compact.jpg` | Compact version for smaller contexts |
| `public/favicon.svg` | Browser tab favicon |

The logo is also implemented as an inline React SVG component (`AlotoWordmark` and `AlotoMark`) in `src/components/ui/AlotoLogo.jsx` — no image file dependency in the app itself, scales perfectly at any size.

**Logo design:**
- Green mowed-pitch background
- White goalpost frame with net grid
- Black A, L, T letterforms
- Middle O = Premier League inspired ball (white, royal blue band, purple chevron, seam lines)
- Final O = Pitch centre circle (dark green, white ring, centre spot, halfway line — no arch)
- PREDICTION PRO sub-label in white

---

## Quick start

### 1. Supabase
1. Create a project at supabase.com
2. Run `supabase/migrations/001_initial_schema.sql` in SQL Editor
3. Copy Project URL and Anon Key from Settings → API

### 2. Environment variables
Create `.env` in the project root:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Local development
```bash
npm install
npm run dev
```

### 4. Deploy to Netlify
Push to GitHub → connect to Netlify → add env vars → deploy.

### 5. Make yourself admin
```sql
update profiles set role = 'admin' where email = 'your@email.com';
```

---

## Key architecture decisions

**Monthly leaderboard** — driven by `month_key` (YYYY-MM) on each gameweek, set by the admin. This allows flexibility around international breaks and fixtures spanning month boundaries.

**Reminder system** — Supabase Edge Function (`supabase/functions/send-reminders/index.ts`) called hourly by pg_cron. Sends WhatsApp (via Twilio) and/or SMS at 24h, 6h, 1h before each fixture kickoff. Only sends to players who haven't yet predicted. Deduplication via `reminder_log` table.

**Scoring engine** — all scoring logic in `src/lib/scoring.js`. Exact score, correct result, clean sheet bonus, knockout predictions. Fully configurable per competition.

---

## Full setup guide

See `ALOTO_Prediction_Pro_Setup_Guide.docx` for the complete click-by-click deployment guide covering every step from blank computer to live app with automated WhatsApp/SMS reminders.

---

© ALOTO. All rights reserved.
