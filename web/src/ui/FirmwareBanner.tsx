import { useCallback, useEffect, useState } from 'react'
import type { FirmwareInfoSource } from '../app/ports'
import { describeFirmware, type InstalledFirmware } from '../domain/firmwareRelease'

const none: InstalledFirmware = { release: null, versions: [], envs: [] }

/** Shows which firmware release the firmware directory holds, and warns when the event expects another. */
export function FirmwareBanner({ source, eventTag }: { source: FirmwareInfoSource; eventTag?: string }) {
  const [info, setInfo] = useState<InstalledFirmware | null>(null)
  const [failed, setFailed] = useState('')

  const refresh = useCallback(() => {
    source.installed().then(
      (i) => (setInfo(i), setFailed('')),
      (e: unknown) => (setInfo(none), setFailed(e instanceof Error ? e.message : String(e))),
    )
  }, [source])
  useEffect(refresh, [refresh])

  if (!info) return null
  const status = describeFirmware(info, eventTag)
  return (
    <p aria-label="installed firmware" className={`notice ${status.level === 'ok' ? 'ok' : 'warn'}`}>
      {status.text}
      {failed && ` (could not read the firmware directory: ${failed})`}{' '}
      <button onClick={refresh}>Check again</button>
    </p>
  )
}
