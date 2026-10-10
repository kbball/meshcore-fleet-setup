import { unzipSync } from 'fflate'
import { bytesToHex, fromUtf8 } from '../../domain/bytes'
import { findFirmware, parseManifest, type ManifestEntry } from '../../domain/manifest'
import type { DfuPackage } from '../../domain/dfu'
import type { FirmwareInfoSource, FirmwareSource } from '../../app/ports'
import { installedFrom, type InstalledFirmware } from '../../domain/firmwareRelease'

export async function sha256Hex(data: Uint8Array, c: Crypto = globalThis.crypto): Promise<string> {
  return bytesToHex(new Uint8Array(await c.subtle.digest('SHA-256', data as BufferSource)))
}

/** Unpack an nRF52 DFU zip (manifest.json + .bin + .dat). Application images only. */
export function unpackDfuZip(zip: Uint8Array): DfuPackage {
  const files = unzipSync(zip)
  const m = files['manifest.json']
  if (!m) throw new Error('firmware zip has no manifest.json')
  const app = JSON.parse(fromUtf8(m))?.manifest?.application
  if (!app?.bin_file || !app?.dat_file) throw new Error('firmware zip is not an application-only DFU package')
  const bin = files[app.bin_file]
  const dat = files[app.dat_file]
  if (!bin || !dat) throw new Error('firmware zip is missing its bin or dat file')
  return { bin, dat }
}

export class HttpFirmwareSource implements FirmwareSource {
  constructor(
    private manifestUrl: string,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
    private c: Crypto = globalThis.crypto,
  ) {}

  async load(env: string, version?: string): Promise<{ entry: ManifestEntry; pkg: DfuPackage }> {
    const res = await this.fetchFn(this.manifestUrl)
    if (!res.ok) throw new Error(`could not fetch the firmware manifest (${res.status})`)
    const manifest = parseManifest(await res.json())
    const entry = findFirmware(manifest, env, version)
    if (!entry)
      throw new Error(`no firmware for '${env}'${version ? ` version ${version}` : ''} in the manifest`)

    const zipRes = await this.fetchFn(
      new URL(
        entry.file,
        new URL(this.manifestUrl, globalThis.location?.href ?? 'http://localhost/'),
      ).toString(),
    )
    if (!zipRes.ok) throw new Error(`could not fetch ${entry.file} (${zipRes.status})`)
    const zip = new Uint8Array(await zipRes.arrayBuffer())
    if ((await sha256Hex(zip, this.c)) !== entry.sha256.toLowerCase())
      throw new Error(`checksum mismatch for ${entry.file}; refusing to flash`)
    return { entry, pkg: unpackDfuZip(zip) }
  }
}

/** Reads the manifest and `.release` next to it. Either may be missing: that is reported, not thrown. */
export class HttpFirmwareInfo implements FirmwareInfoSource {
  constructor(
    private manifestUrl: string,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  async installed(): Promise<InstalledFirmware> {
    const base = new URL(this.manifestUrl, globalThis.location?.href ?? 'http://localhost/')
    const [manifest, release] = await Promise.all([
      this.fetchFn(base.toString()).then(async (r) => (r.ok ? parseManifest(await r.json()) : null)),
      this.fetchFn(new URL('.release', base).toString()).then((r) => (r.ok ? r.text() : null)),
    ])
    return installedFrom(manifest, release)
  }
}
