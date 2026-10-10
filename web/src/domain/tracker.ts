// Sweep tracker configuration. Port of tools/provision_tracker.py in the firmware fork
// (kbball/MeshCore-tracker, branch gps-tracker): keep the validation rules identical.

export const DEFAULT_MIN_INTERVAL = 300
export const VALID_BW = [7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500]

export type TrackerConfig = {
  channel_name?: string
  channel_psk?: string
  interval_sec?: number
  nofix_mode?: 'silent' | 'notify'
  nofix_notify_interval_sec?: number
  freq?: number
  bw?: number
  sf?: number
  cr?: number
  tx_power?: number
  idle_interval_sec?: number
  idle_holdoff_sec?: number
  fix_timeout_sec?: number
  move_distance_m?: number
  motion_threshold?: number
}

// JSON key -> [device setting, readback key]
const SIMPLE_KEYS: Record<string, [string, string]> = {
  interval_sec: ['interval', 'interval'],
  nofix_mode: ['nofix', 'nofix'],
  nofix_notify_interval_sec: ['nofix_interval', 'nofix_interval'],
  freq: ['freq', 'freq'],
  bw: ['bw', 'bw'],
  sf: ['sf', 'sf'],
  cr: ['cr', 'cr'],
  tx_power: ['tx', 'tx'],
  idle_interval_sec: ['idle_interval', 'idle_interval'],
  idle_holdoff_sec: ['idle_holdoff', 'idle_holdoff'],
  fix_timeout_sec: ['fix_timeout', 'fix_timeout'],
  move_distance_m: ['move_dist', 'move_dist'],
  motion_threshold: ['motion', 'motion'],
}
const ALLOWED_KEYS = new Set([...Object.keys(SIMPLE_KEYS), 'channel_name', 'channel_psk'])

export type TrackerCommand = {
  /** Command line to send; null means verify-only. */
  command: string | null
  readbackKey: string
  expected: string | number
}

/** The device wants base64. Accept the 32/64 character hex form too. */
export function normalizePsk(psk: string): string {
  if ((psk.length === 32 || psk.length === 64) && /^[0-9a-fA-F]+$/.test(psk)) {
    const bytes = psk.match(/../g)!.map((h) => parseInt(h, 16))
    return btoa(String.fromCharCode(...bytes))
  }
  return psk
}

export function validateTrackerConfig(cfg: unknown, minInterval = DEFAULT_MIN_INTERVAL): string[] {
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) return ['config must be a JSON object']
  const c = cfg as Record<string, unknown>
  const problems: string[] = []

  for (const k of Object.keys(c)) {
    if (!ALLOWED_KEYS.has(k)) {
      const hint =
        k === 'name' || k === 'node_name'
          ? ' (the node name comes from the name template, not the profile)'
          : ''
      problems.push(`unknown key '${k}'${hint}`)
    }
  }
  if ('channel_name' in c !== 'channel_psk' in c) {
    problems.push('channel_name and channel_psk must be given together')
  }
  for (const k of ['channel_name', 'channel_psk']) {
    if (!(k in c)) continue
    const v = c[k]
    if (typeof v !== 'string' || v === '' || (k === 'channel_psk' && v.includes(' '))) {
      problems.push(`${k} must be a non-empty string${k === 'channel_psk' ? ' without spaces' : ''}`)
    }
  }
  if (typeof c.channel_name === 'string' && c.channel_name.length > 31) {
    problems.push('channel_name must be at most 31 characters')
  }

  const num = (key: string, lo: number, hi: number, integer = true) => {
    if (!(key in c)) return
    const v = c[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || (integer && !Number.isInteger(v))) {
      problems.push(`${key} must be a${integer ? 'n integer' : ' number'}`)
    } else if (v < lo || v > hi) {
      problems.push(`${key} must be between ${lo} and ${hi}`)
    }
  }
  num('interval_sec', minInterval, 86400)
  num('nofix_notify_interval_sec', minInterval, 604800)
  num('idle_interval_sec', minInterval, 86400)
  num('idle_holdoff_sec', 60, 3600)
  num('fix_timeout_sec', 10, 300)
  num('move_distance_m', 5, 500)
  num('motion_threshold', 1, 255)
  num('freq', 150, 960, false)
  num('sf', 5, 12)
  num('cr', 5, 8)
  num('tx_power', -9, 22)
  if ('bw' in c) {
    const bw = c.bw
    if (typeof bw !== 'number' || !VALID_BW.some((b) => Math.abs(bw - b) < 0.01)) {
      problems.push(`bw must be one of ${VALID_BW.join(', ')}`)
    }
  }
  if ('nofix_mode' in c && c.nofix_mode !== 'silent' && c.nofix_mode !== 'notify') {
    problems.push("nofix_mode must be 'silent' or 'notify'")
  }
  return problems
}

/** Ordered commands for the config; the name (if any) goes first. */
export function buildTrackerCommands(cfg: TrackerConfig, name?: string): TrackerCommand[] {
  const cmds: TrackerCommand[] = []
  if (name !== undefined) cmds.push({ command: `set name ${name}`, readbackKey: 'name', expected: name })
  if (cfg.channel_name !== undefined && cfg.channel_psk !== undefined) {
    const psk = normalizePsk(cfg.channel_psk)
    cmds.push({
      command: `set channel ${psk} ${cfg.channel_name}`,
      readbackKey: 'channel',
      expected: cfg.channel_name,
    })
    cmds.push({ command: null, readbackKey: 'psk', expected: psk })
  }
  for (const [key, [setting, readback]] of Object.entries(SIMPLE_KEYS)) {
    const v = (cfg as Record<string, string | number | undefined>)[key]
    if (v !== undefined) cmds.push({ command: `set ${setting} ${v}`, readbackKey: readback, expected: v })
  }
  return cmds
}

export function valuesMatch(expected: string | number, actual: string | undefined): boolean {
  if (actual === undefined) return false
  const e = Number(expected)
  const a = Number(actual)
  if (
    typeof expected === 'number' ||
    (!Number.isNaN(e) && !Number.isNaN(a) && String(expected).trim() !== '')
  ) {
    if (!Number.isNaN(e) && !Number.isNaN(a)) return Math.abs(e - a) < 0.0015
  }
  return String(expected) === actual
}

/** Never show the PSK in logs or UI. */
export function redactCommand(cmd: string): string {
  return cmd.startsWith('set channel ') ? 'set channel <psk> ' + cmd.split(' ').slice(3).join(' ') : cmd
}

/** Expand a name template: `Sweep{n}` with n=3 gives `Sweep3`. Name must be 1-31 characters. */
export function expandName(template: string, n: number): string {
  const name = template.replaceAll('{n}', String(n))
  if (name.length < 1 || name.length > 31) throw new Error(`node name '${name}' must be 1-31 characters`)
  return name
}
