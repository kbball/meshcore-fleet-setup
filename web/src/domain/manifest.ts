export type ManifestEntry = {
  board: string
  env: string
  kind: 'companion' | 'tracker'
  version: string
  file: string // path relative to the manifest
  sha256: string
}
export type Manifest = { entries: ManifestEntry[] }

export function parseManifest(json: unknown): Manifest {
  const entries = (json as { entries?: unknown })?.entries
  if (!Array.isArray(entries)) throw new Error('manifest has no entries list')
  for (const [i, e] of entries.entries()) {
    for (const k of ['board', 'env', 'kind', 'version', 'file', 'sha256']) {
      if (typeof e?.[k] !== 'string' || !e[k]) throw new Error(`manifest entry ${i} is missing '${k}'`)
    }
    if (e.kind !== 'companion' && e.kind !== 'tracker') throw new Error(`manifest entry ${i} has bad kind`)
    if (!/^[0-9a-f]{64}$/i.test(e.sha256)) throw new Error(`manifest entry ${i} has a bad sha256`)
  }
  return { entries: entries as ManifestEntry[] }
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
