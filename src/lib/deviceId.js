import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

/**
 * An ID for this phone, so the free Last Man Standing game is one per phone
 * rather than one per account (migration 130). Nothing about the person is in
 * it.
 *
 *   iPhone   a random ID kept in the keychain. iOS keeps keychain items when
 *            the app is deleted, so reinstalling gives the same ID.
 *   Android  Android's own ID for this app on this phone, which also stays the
 *            same across reinstalls.
 *   Website  none (Last Man Standing games are started from the phone app).
 */
const KEY = 'aloto_device_id'
let cached = null

export async function getDeviceId() {
  if (!Capacitor.isNativePlatform()) return null
  if (cached) return cached
  try {
    const platform = Capacitor.getPlatform()
    if (platform === 'android') {
      const { Device } = await import('@capacitor/device')
      const { identifier } = await Device.getId()
      if (identifier) return (cached = `android:${identifier}`)
    }
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage')
    let id = await SecureStorage.get(KEY, false, false)
    if (!id) {
      id = crypto.randomUUID()
      await SecureStorage.set(KEY, id, false, false)
    }
    return (cached = `${platform}:${id}`)
  } catch (err) {
    console.warn('Device ID unavailable:', err?.message || err)
    return null
  }
}

/** Records this phone against the signed-in account. Never throws. */
export async function registerDevice() {
  try {
    const id = await getDeviceId()
    if (id) await supabase.rpc('register_device', { p_device_id: id })
  } catch { /* the game start will ask again */ }
}
