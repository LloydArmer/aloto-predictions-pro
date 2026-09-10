import { useState, useEffect } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { Card, Button, Spinner } from '../../ui'
import {
  canPurchase, initPurchases, getProPackage, purchasePro,
  restorePurchases, getProStatus, waitForEntitlement,
} from '../../../lib/pro'
import toast from 'react-hot-toast'

/**
 * Pro status and upgrade.
 *
 * Shows one of three things: what Pro would add (not subscribed), what they
 * have and until when (subscribed), or how to get it on a phone (browser).
 *
 * In-app purchases only exist inside the native app. On the website there is
 * no App Store to buy through, so the browser is told plainly rather than shown
 * a button that cannot work.
 */
export default function ProUpgrade() {
  const { user } = useAuth()
  const [status, setStatus] = useState(null)
  const [pkg, setPkg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Status comes from OUR database, so it is correct in a browser too — a
      // subscriber checking on a laptop should still see what they have.
      const s = await getProStatus()
      if (!cancelled) setStatus(s)

      if (canPurchase() && user?.id) {
        await initPurchases(user.id)
        const p = await getProPackage()
        if (!cancelled) setPkg(p)
      }

      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [user?.id])

  async function buy() {
    setBusy(true)
    try {
      const result = await purchasePro(pkg)

      if (!result.ok) {
        // Changing your mind at the Apple sheet is ordinary, not a failure.
        // Showing an error for it reads as a fault in the app.
        if (result.reason === 'cancelled') return
        toast.error(result.message || 'The purchase could not be completed')
        return
      }

      // The payment completes on the device before RevenueCat has told our
      // webhook, so reading the database now would still say "not Pro" — and
      // someone who has just paid £29.99 would see an unchanged screen.
      toast.success('Payment received — activating…')
      const active = await waitForEntitlement()

      if (active) {
        setStatus(active)
        toast.success('Pro is active')
      } else {
        // Paid but not yet applied. Said honestly, with what to do, rather
        // than left looking like the money vanished.
        toast.error('Payment went through but activation is taking longer than usual. It will appear shortly — tap Restore purchases if it does not.')
      }
    } finally { setBusy(false) }
  }

  async function restore() {
    setBusy(true)
    try {
      const result = await restorePurchases()

      if (!result.ok) {
        toast.error(result.reason === 'nothing-to-restore'
          ? 'No previous purchase found for this Apple ID'
          : 'Could not restore purchases')
        return
      }

      const active = await waitForEntitlement({ tries: 6 })
      setStatus(active || await getProStatus())
      toast.success('Purchase restored')
    } finally { setBusy(false) }
  }

  if (loading) return <Card className="p-4 mb-5"><Spinner/></Card>

  /* ---- Already Pro ---- */
  if (status?.isPro) {
    const permanent = !status.expiresAt
    const renews = status.willRenew

    return (
      <Card className="p-4 mb-5" style={{ background: 'var(--gold-dim)', borderColor: 'rgba(245,200,66,0.35)' }}>
        <div className="flex items-center gap-2 mb-1.5">
          <i className="ti ti-crown text-sm" style={{ color: 'var(--gold)' }} aria-hidden="true"/>
          <p className="text-sm font-semibold" style={{ color: 'var(--gold)' }}>ALOTO Pro</p>
        </div>

        <p className="text-xs mb-2" style={{ color: 'var(--txt-second)', lineHeight: 1.55 }}>
          Unlimited competitions and the season archive.
        </p>

        {!permanent && (
          <p className="text-xs" style={{ color: 'var(--txt-muted)' }}>
            {renews
              ? `Renews ${new Date(status.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
              /* Cancelled, but paid until the date. Saying "not subscribed"
                 to someone with two months left is how support emails start. */
              : `Active until ${new Date(status.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} — will not renew`}
          </p>
        )}

        {!permanent && (
          <p className="text-xs mt-2" style={{ color: 'var(--txt-muted)' }}>
            Manage or cancel in Settings → Apple ID → Subscriptions on your iPhone.
          </p>
        )}
      </Card>
    )
  }

  /* ---- Not Pro, in a browser ---- */
  if (!canPurchase()) {
    return (
      <Card className="p-4 mb-5">
        <div className="flex items-center gap-2 mb-1.5">
          <i className="ti ti-crown text-sm" style={{ color: 'var(--gold)' }} aria-hidden="true"/>
          <p className="text-sm font-semibold" style={{ color: 'var(--txt-primary)' }}>ALOTO Pro</p>
        </div>
        <ProBenefits/>
        <p className="text-xs mt-2.5" style={{ color: 'var(--txt-muted)' }}>
          Pro is purchased in the iPhone app. Open ALOTO on your phone and come back to Settings.
        </p>
      </Card>
    )
  }

  /* ---- Not Pro, on a phone ---- */
  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center gap-2 mb-1.5">
        <i className="ti ti-crown text-sm" style={{ color: 'var(--gold)' }} aria-hidden="true"/>
        <p className="text-sm font-semibold" style={{ color: 'var(--txt-primary)' }}>ALOTO Pro</p>
      </div>

      <ProBenefits/>

      <div className="mt-3">
        <Button variant="primary" className="w-full justify-center" onClick={buy}
          disabled={busy || !pkg}>
          {busy ? 'Just a moment…'
            : pkg ? `Upgrade — ${pkg.product?.priceString ?? '£29.99'} a year`
            : 'Loading…'}
        </Button>

        {/* Apple REQUIRES a restore option in any app selling a subscription,
            and rejects apps without one. It is also genuinely needed: a new
            phone or a reinstall leaves someone who has paid with nothing until
            they restore. */}
        <button onClick={restore} disabled={busy}
          className="text-xs w-full text-center mt-2.5"
          style={{ color: 'var(--txt-muted)', textDecoration: 'underline' }}>
          Restore purchases
        </button>
      </div>

      <p className="text-xs mt-3" style={{ color: 'var(--txt-muted)', lineHeight: 1.5 }}>
        Renews annually until cancelled. Cancel any time in Settings → Apple ID → Subscriptions;
        you keep Pro until the end of the period you have paid for.
      </p>
    </Card>
  )
}

/** What Pro actually adds. Kept in one place so both states agree. */
function ProBenefits() {
  return (
    <div className="text-xs" style={{ color: 'var(--txt-second)', lineHeight: 1.7 }}>
      <p>· Unlimited leagues, cups and season predictions</p>
      <p>· A full archive of past seasons</p>
      <p style={{ color: 'var(--txt-muted)', marginTop: 6 }}>
        The free plan includes one league, one cup and one set of season predictions.
        Playing is always free, however many competitions you are in.
      </p>
    </div>
  )
}
