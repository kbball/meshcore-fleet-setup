// Which firmware release is installed in the firmware directory, and does it match what an event needs?
// The go-box's `make firmware` writes the release tag (e.g. `ares-v1.0.0`) to `firmware/.release`.
import type { Manifest } from './manifest'

const TAG_RE = /^ares-v\d+\.\d+\.\d+$/

export type InstalledFirmware = {
  /** Contents of `.release`, or null when the file is missing or not a release tag. */
  release: string | null
  /** Distinct manifest versions, e.g. `v1.0.0-2db5a14`. Empty when there is no manifest. */
  versions: string[]
  envs: string[]
}

/** First line of the `.release` file if it looks like a release tag. Anything else is ignored. */
export function parseReleaseFile(text: string): string | null {
  const line = text.split('\n')[0].trim()
  return TAG_RE.test(line) ? line : null
}

export function installedFrom(manifest: Manifest | null, releaseText: string | null): InstalledFirmware {
  return {
    release: releaseText === null ? null : parseReleaseFile(releaseText),
    versions: [...new Set(manifest?.entries.map((e) => e.version) ?? [])],
    envs: [...new Set(manifest?.entries.map((e) => e.env) ?? [])],
  }
}

/** `ares-v1.0.0` matches manifest versions `v1.0.0` and `v1.0.0-2db5a14`. */
export const versionOfTag = (tag: string) => tag.replace(/^ares-/, '')
const versionMatchesTag = (version: string, tag: string) => {
  const v = versionOfTag(tag)
  return version === v || version.startsWith(v + '-')
}

export type FirmwareStatus = { level: 'ok' | 'warn' | 'none'; text: string }

/** What to tell the operator. `eventTag` is the release the loaded event expects, if any. */
export function describeFirmware(inst: InstalledFirmware, eventTag?: string): FirmwareStatus {
  if (inst.versions.length === 0)
    return {
      level: 'none',
      text: 'No firmware is loaded. Install a release into the firmware directory (make firmware in the go-box).',
    }
  const what = inst.release
    ? `${inst.release} (${inst.versions.join(', ')})`
    : `${inst.versions.join(', ')} (no .release file)`
  if (!eventTag) return { level: 'ok', text: `Firmware installed: ${what}.` }
  const matches = inst.release
    ? inst.release === eventTag
    : inst.versions.some((v) => versionMatchesTag(v, eventTag))
  return matches
    ? { level: 'ok', text: `Firmware installed: ${what}, as the event expects.` }
    : { level: 'warn', text: `Firmware installed: ${what}, but the event expects ${eventTag}.` }
}
