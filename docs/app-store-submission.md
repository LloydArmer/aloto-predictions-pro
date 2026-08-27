# App Store submission

Everything App Store Connect asks for, with the answers ready. Work down it.

---

## 1. Before anything else

Replace `REPLACE_WITH_YOUR_EMAIL` in **one** place:

```
src/components/features/legal/Privacy.jsx     ->  SUPPORT_EMAIL
```

Both legal pages read that constant, so one edit covers them.

Then check the pages actually load:

```
https://aloto-prediction-pro.netlify.app/privacy
https://aloto-prediction-pro.netlify.app/support
```

Apple fetches these. A 404 is a rejection, and it's the most common one for
small apps.

If you've pointed your own domain at the site, use that instead — it looks more
credible on a listing than a netlify.app subdomain.

---

## 2. App Information

| Field | Value |
|---|---|
| Name | ALOTO Prediction Pro |
| Subtitle | Football predictions for your league |
| Category | Sports |
| Secondary category | Games (optional) |
| Content rights | Does not contain third-party content |

**Subtitle limit is 30 characters.** The one above is 38 — shorten to
`Predictions for your league` (27) or similar.

---

## 3. Age rating

Answer the questionnaire honestly. Two that matter:

**Contests / gambling** — answer **No**. The app has no stake, no prize pool and
no cash. It's a scoring game between friends.

**Unrestricted web access** — **No**. The app doesn't open arbitrary web pages.

That should land you at 4+.

---

## 4. Privacy details

Apple asks what you collect. From the actual app:

| Data | Collected | Linked to identity | Used for tracking |
|---|---|---|---|
| Email address | Yes | Yes | No |
| Name (display name) | Yes | Yes | No |
| User content (predictions) | Yes | Yes | No |
| Identifiers (push token) | Yes | Yes | No |

Purpose for all four: **App Functionality**.

Answer **No** to tracking across apps and websites. That is true — there are no
advertising identifiers and no third-party analytics.

Privacy policy URL: `https://<your-domain>/privacy`

---

## 5. Screenshots

Required: **6.7-inch iPhone, 1290 x 2796**. That's an iPhone 15 Pro Max frame.

You can take them from the live web app on any iPhone and scale, or use the
TestFlight build and screenshot directly.

Five worth showing, in this order:

1. **Dashboard** with a live gameweek and a pending-predictions card
2. **Predict** mid-entry, scores partly filled
3. **Standings** with several players and a gap at the top
4. **Cup bracket** part-resolved, so it doesn't look empty
5. **Season Predictions** with a countdown running

Use a competition with realistic names and scores. Screenshots of an empty test
league make the app look unused.

A video is optional on both stores. Skip it initially — a 30-second App Preview
is fiddly and rarely shifts installs for a niche app.

---

## 6. Description

> ALOTO Prediction Pro turns a football season into a competition between you
> and your mates.
>
> Predict the score of every match. Points for calling the result, more for the
> exact score, and bonuses for a perfect gameweek. Play your Triple Points chip
> on the week you fancy and watch it swing the table.
>
> Run a straight league, add a knockout cup alongside it, or set season-long
> predictions before a ball is kicked — the final league table, the cup winners,
> the golden boot.
>
> Private by design. No public leaderboards and no strangers: your admin shares
> a join code and only the people with it get in. Predictions stay hidden until
> kick-off, so nobody can copy yours.
>
> Reminders when a gameweek opens, and again if you still have predictions
> outstanding — so you never lose points to a forgotten deadline.
>
> Free to play. Running a league is free too, including one cup and one final
> league table. Pro lifts those limits for admins who want more.

**Keywords** (100 characters, comma separated, no spaces after commas):

```
football,predictions,league,soccer,fixtures,scores,sweepstake,office,friends,prediction,game
```

---

## 7. App Review Information

**This is the section most likely to get you rejected if skipped.** The app is
useless without an account, so the reviewer needs one.

Create a demo account on production, put it in a competition with real fixtures
and a few gameweeks of history, then supply:

| Field | Value |
|---|---|
| Sign-in required | Yes |
| Username | the demo account's email |
| Password | its password |

**Notes** — paste this:

> ALOTO Prediction Pro is a private football prediction game. Competitions are
> not public: an admin shares a six-character join code and only people with the
> code can join.
>
> The demo account above is already a member of a competition with fixtures and
> results, so you can see predictions, scoring and standings straight away.
>
> To see the join flow, sign up with any email and enter code: XXXXXX
>
> The app uses push notifications to remind players about prediction deadlines.
> These are requested when the player turns reminders on in Settings, not on
> launch.
>
> There is no gambling, wagering or prize element. Points are for bragging
> rights only.

Replace `XXXXXX` with a real join code from Admin -> Players.

Also give a contact first name, last name, phone number and email.

---

## 8. Export compliance

Asked on every build. The app uses HTTPS only, so:

- Does your app use encryption? **Yes**
- Does it qualify for exemption? **Yes** — standard encryption only (HTTPS)

You'll get the ITSAppUsesNonExemptEncryption question once and it's remembered.

---

## 9. Submit

App Store Connect -> your app -> the version -> **Add for Review**.

First reviews are typically 24-48 hours.

**If rejected**, Apple says exactly why in Resolution Center and you reply
there. Rejection is routine — it's a conversation, not a verdict.

The two likely reasons for this app:

**Guideline 4.2, minimum functionality** — repackaged websites get rejected.
Point out the native push notifications and the depth of scoring, cups and
season predictions if it comes up.

**Guideline 2.1, incomplete information** — usually a demo account that doesn't
work. Test the credentials yourself before submitting.

---

## 10. After approval

Add `--testflight` back to the upload step in `codemagic.yaml` once Test
Information is filled in, so your league can test future builds before they go
live.
