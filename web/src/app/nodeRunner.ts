import { bytesToHex } from '../domain/bytes'
import { cmd, parseSelfInfo } from '../domain/companion'
import { bootloaderOf } from '../domain/manifest'
import { appStartAddress, packUf2 } from '../domain/uf2'
import type { CompanionProfile, TrackerProfile } from '../domain/profile'
import { backupNode } from './backup'
import { CompanionClient, CompanionTimeoutError } from './companionClient'
import { applyCompanionProfile, readIdentity, verifyCompanionProfile } from './companionConfig'
import { flashPackage } from './flashNode'
import type {
  BackupCipher,
  Prompt,
  BackupSink,
  Clock,
  FirmwareSource,
  FrameLink,
  LineLink,
  Logger,
  NodeConnector,
} from './ports'
import { provisionTracker } from './provisionTracker'
import { TrackerCli } from './trackerCli'

export type StepName = 'connect' | 'backup' | 'flash' | 'wipe' | 'configure' | 'verify'
export type StepResult = { step: StepName; status: 'ok' | 'skipped' | 'failed'; detail?: string }

/** One line of the results log. Never contains keys or passphrases. */
export type NodeResult = {
  name: string
  kind: 'companion' | 'gateway' | 'tracker'
  publicKey?: string
  startedAt: string
  steps: StepResult[]
  ok: boolean
  backupFile?: string
}

export type RunOptions = {
  nodeName?: string
  flash: boolean
  firmwareVersion?: string
  backup?: { passphrase: string } // present = back up first
}

export type RunnerDeps = {
  connector: NodeConnector
  firmware: FirmwareSource
  cipher: BackupCipher
  sink: BackupSink
  clock: Clock
  log: Logger
  /** Tell the operator something they must do (e.g. press the bootloader button). */
  prompt: Prompt
  onProgress?: (step: StepName, pct: number) => void
  /** How long to wait for each tracker CLI reply (default 5 s). */
  trackerTimeoutMs?: number
  /** How long to wait for each companion reply (default 5 s). */
  companionTimeoutMs?: number
}

const REOPEN_TIMEOUT_MS = 30_000
/** Format the filesystem, the firmware's own 1 s pause, then the reboot. 8 s was enough on a T-1000-E. */
export const WIPE_REBOOT_MS = 8_000

class StopRun extends Error {}

export class NodeRunner {
  constructor(private d: RunnerDeps) {}

  async runCompanion(p: CompanionProfile, o: RunOptions): Promise<NodeResult> {
    const res = this.start(o.nodeName ?? '(unnamed)', p.kind)
    let link: FrameLink | null = null
    let unresponsive = false
    try {
      link = await this.step(res, 'connect', async () => {
        const l = await this.d.connector.openFrames()
        try {
          const id = await readIdentity(new CompanionClient(l, this.d.companionTimeoutMs))
          res.publicKey = bytesToHex(id.self.publicKey)
        } catch (e) {
          // don't leave the port open and locked, or the operator's retry fails with "already open"
          await l.close().catch(() => {})
          if (!(e instanceof CompanionTimeoutError)) throw e
          // Silent node: a new board, or one running firmware without the USB companion protocol. Flashing
          // is how it gets fixed, so go on to the bootloader; a backup needs a talking node, so refuse.
          if (!o.flash || o.backup) {
            throw new Error(
              `${e.message}. The node is not running a USB companion build${o.backup ? ', so it cannot be backed up (turn the backup off to flash it anyway)' : ''}.`,
              { cause: e },
            )
          }
          this.d.log.warn('node did not answer; flashing anyway', { detail: e.message })
          unresponsive = true
          return null
        }
        return l
      })
      if (unresponsive) res.steps.at(-1)!.detail = 'no reply from the node; going on to flash it'

      if (o.backup) {
        await this.step(res, 'backup', async () => {
          const b = await backupNode(
            new CompanionClient(link!),
            this.d,
            o.backup!.passphrase,
            p.firmware_variant,
          )
          res.backupFile = b.filename
        })
      } else this.skip(res, 'backup')

      if (o.flash) {
        await this.step(res, 'flash', async () => {
          await this.flashFirmware(p.firmware_variant, o.firmwareVersion, async () => link?.close())
          link = await this.d.connector.reopenFrames(REOPEN_TIMEOUT_MS)
        })
      } else this.skip(res, 'flash')

      if (p.wipe_first) {
        await this.step(res, 'wipe', async () => {
          // The firmware disables its serial interface before it formats, so no OK ever comes back over USB;
          // it reboots by itself about a second after the format. Send, let go of the port, wait it out.
          await new CompanionClient(link!).fireAndForget(cmd.factoryReset())
          await link!.close()
          await this.d.clock.sleep(WIPE_REBOOT_MS)
          link = await this.d.connector.reopenFrames(REOPEN_TIMEOUT_MS)
        })
      } else this.skip(res, 'wipe')

      const c = new CompanionClient(link!)
      await this.step(res, 'configure', async () => {
        await applyCompanionProfile(c, p, { nodeName: o.nodeName, clock: this.d.clock, log: this.d.log })
      })
      await this.step(res, 'verify', async () => {
        const bad = await verifyCompanionProfile(c, p, o.nodeName)
        if (bad.length) throw new Error('verify failed:\n  ' + bad.join('\n  '))
        // the public key can change when an identity is imported or after a wipe
        const self = parseSelfInfo(await c.request(cmd.appStart(), 'app start'))
        res.publicKey = bytesToHex(self.publicKey)
      })
    } catch (e) {
      if (!(e instanceof StopRun)) throw e
    } finally {
      await link?.close().catch(() => {})
    }
    return this.finish(res)
  }

  async runTracker(p: TrackerProfile, o: RunOptions): Promise<NodeResult> {
    const res = this.start(o.nodeName ?? '(unnamed)', 'tracker')
    let link: LineLink | null = null
    try {
      link = await this.step(res, 'connect', async () => this.d.connector.openLines())
      this.skip(res, 'backup')

      if (o.flash) {
        await this.step(res, 'flash', async () => {
          await this.flashFirmware(p.firmware_variant, o.firmwareVersion, async () => link?.close())
          link = await this.d.connector.reopenLines(REOPEN_TIMEOUT_MS)
        })
      } else this.skip(res, 'flash')
      this.skip(res, 'wipe')

      await this.step(res, 'configure', async () => {
        // provisionTracker applies, reads back and verifies, then reboots
        await provisionTracker(
          new TrackerCli(link!, this.d.trackerTimeoutMs),
          p.config,
          o.nodeName,
          this.d.log,
        )
      })
      res.steps.push({ step: 'verify', status: 'ok', detail: 'read back during configure' })
    } catch (e) {
      if (!(e instanceof StopRun)) throw e
    } finally {
      await link?.close().catch(() => {})
    }
    return this.finish(res)
  }

  // ---- helpers ----

  /**
   * Load a firmware package and put it on the board the way its bootloader wants: serial DFU, or a .uf2 file
   * copied to the bootloader drive (T-1000-E). `release` lets go of the app's serial port first.
   */
  private async flashFirmware(variant: string, version: string | undefined, release: () => Promise<void>) {
    const { entry, pkg } = await this.d.firmware.load(variant, version)
    if (bootloaderOf(entry) === 'uf2') {
      const uf2 = packUf2(pkg.bin, appStartAddress(pkg.softdeviceReq)) // before touching the board: bad ids fail early
      await release()
      const drive = await this.d.connector.openUf2Drive(this.d.prompt)
      await drive.write(`${entry.env}.uf2`, uf2)
      this.d.onProgress?.('flash', 100)
      return
    }
    await release()
    const dfu = await this.d.connector.openBootloader(this.d.prompt)
    await flashPackage(dfu, pkg, this.d.clock, this.d.log, (pct) => this.d.onProgress?.('flash', pct))
  }

  private start(name: string, kind: NodeResult['kind']): NodeResult {
    return { name, kind, startedAt: this.d.clock.now().toISOString(), steps: [], ok: false }
  }

  private skip(res: NodeResult, step: StepName) {
    res.steps.push({ step, status: 'skipped' })
  }

  /** Run a step; on failure record it and stop the run so later steps (wipe!) never happen. */
  private async step<T>(res: NodeResult, step: StepName, fn: () => Promise<T>): Promise<T> {
    try {
      const v = await fn()
      res.steps.push({ step, status: 'ok' })
      return v
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      this.d.log.error('step failed', { step, detail })
      res.steps.push({ step, status: 'failed', detail })
      throw new StopRun(detail)
    }
  }

  private finish(res: NodeResult): NodeResult {
    res.ok = res.steps.every((s) => s.status !== 'failed')
    return res
  }
}
