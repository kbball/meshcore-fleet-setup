import {
  DEFAULT_MIN_INTERVAL,
  buildTrackerCommands,
  redactCommand,
  validateTrackerConfig,
  valuesMatch,
  type TrackerConfig,
} from '../domain/tracker'
import type { Logger } from './ports'
import { TrackerCli, TrackerError } from './trackerCli'

export type ProvisionResult = { verified: string[]; settings: Record<string, string> }

/**
 * Apply a tracker config over the CLI, read it back to verify, then optionally reboot.
 * The caller reconnects after a reboot (the USB port drops).
 */
export async function provisionTracker(
  cli: TrackerCli,
  cfg: TrackerConfig,
  name: string | undefined,
  log: Logger,
  opts: { reboot?: boolean } = {},
): Promise<ProvisionResult> {
  const state = await cli.get()
  if (!('interval' in state)) {
    throw new TrackerError("device did not answer 'get'; is this tracker firmware running?")
  }
  const minInterval = Number(state.min_interval ?? DEFAULT_MIN_INTERVAL)
  const problems = validateTrackerConfig(cfg, minInterval)
  if (problems.length) throw new TrackerError('invalid config:\n  ' + problems.join('\n  '))

  const cmds = buildTrackerCommands(cfg, name)
  for (const { command } of cmds) {
    if (!command) continue
    const shown = redactCommand(command)
    log.info('tracker command', { command: shown })
    await cli.command(command, shown)
  }

  const after = await cli.get()
  const bad = cmds.filter((c) => !valuesMatch(c.expected, after[c.readbackKey]))
  if (bad.length) {
    // never echo expected/actual for psk
    const lines = bad.map((c) =>
      c.readbackKey === 'psk'
        ? 'psk: does not match'
        : `${c.readbackKey}: expected ${JSON.stringify(c.expected)}, device has ${JSON.stringify(after[c.readbackKey])}`,
    )
    throw new TrackerError('readback mismatch:\n  ' + lines.join('\n  '))
  }
  const verified = [...new Set(cmds.map((c) => c.readbackKey))].sort()

  if (opts.reboot ?? true) {
    log.info('tracker reboot')
    try {
      await cli.command('reboot')
    } catch (e) {
      if (!(e instanceof TrackerError)) throw e // the device drops the port while rebooting
    }
  }
  return { verified, settings: after }
}
