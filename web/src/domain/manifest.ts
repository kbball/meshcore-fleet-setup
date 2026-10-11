export type ManifestEntry = {
  board: string
  env: string
  kind: 'companion' | 'gateway' | 'tracker'
  version: string
  file: string // path relative to the manifest
  sha256: string
  /** How the board is flashed. Absent = decided by `bootloaderOf` from the env name. */
  bootloader?: Bootloader
}
export type Bootloader = 'dfu' | 'uf2'
export type Manifest = { entries: ManifestEntry[] }

export function parseManifest(json: unknown): Manifest {
  const entries = (json as { entries?: unknown })?.entries
  if (!Array.isArray(entries)) throw new Error('manifest has no entries list')
  for (const [i, e] of entries.entries()) {
    for (const k of ['board', 'env', 'kind', 'version', 'file', 'sha256']) {
      if (typeof e?.[k] !== 'string' || !e[k]) throw new Error(`manifest entry ${i} is missing '${k}'`)
    }
    if (e.kind !== 'companion' && e.kind !== 'gateway' && e.kind !== 'tracker')
      throw new Error(`manifest entry ${i} has bad kind`)
    if (e.bootloader !== undefined && e.bootloader !== 'dfu' && e.bootloader !== 'uf2')
      throw new Error(`manifest entry ${i} has a bad bootloader`)
    if (!/^[0-9a-f]{64}$/i.test(e.sha256)) throw new Error(`manifest entry ${i} has a bad sha256`)
  }
  return { entries: entries as ManifestEntry[] }
}

/**
 * Serial DFU (Adafruit bootloader) or UF2 mass-storage drive. The T-1000-E's bootloader is UF2-only: it shows a
 * drive and no serial port. The manifest field wins; this default covers releases built before it existed.
 */
export function bootloaderOf(e: Pick<ManifestEntry, 'env' | 'bootloader'>): Bootloader {
  return e.bootloader ?? (e.env.startsWith('t1000e_') ? 'uf2' : 'dfu')
}

const semverParts = (v: string) =>
  v
    .replace(/^v/, '')
    .split(/[.-]/)
    .map((p) => (/^\d+$/.test(p) ? Number(p) : p))

function cmpVersion(a: string, b: string): number {
  const pa = semverParts(a)
  const pb = semverParts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x) < String(y) ? -1 : 1
  }
  return 0
}

/** Newest entry for an env (or the exact version if given). */
export function findFirmware(m: Manifest, env: string, version?: string): ManifestEntry | undefined {
  const matches = m.entries.filter((e) => e.env === env && (version === undefined || e.version === version))
  return matches.sort((a, b) => cmpVersion(b.version, a.version))[0]
}
