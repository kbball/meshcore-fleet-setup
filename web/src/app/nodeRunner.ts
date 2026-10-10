import { bytesToHex } from '../domain/bytes'
import { cmd, parseSelfInfo } from '../domain/companion'
import type { CompanionProfile, TrackerProfile } from '../domain/profile'
import { backupNode } from './backup'
import { CompanionClient } from './companionClient'
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
  kind: 'companion' | 'tracker'
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
}

const REOPEN_TIMEOUT_MS = 30_000

class StopRun extends Error {}

export class NodeRunner {
  constructor(private d: RunnerDeps) {}

  async runCompanion(p: CompanionProfile, o: RunOptions): Promise<NodeResult> {
    const res = this.start(o.nodeName ?? '(unnamed)', 'companion')
    let link: FrameLink | null = null
    try {
      link = await this.step(res, 'connect', async () => {
        const l = await this.d.connector.openFrames()
        const id = await readIdentity(new CompanionClient(l))
        res.publicKey = bytesToHex(id.self.publicKey)
        return l
      })

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
          const { pkg } = await this.d.firmware.load(p.firmware_variant, o.firmwareVersion)
          await link!.close()
          const dfu = await this.d.connector.openBootloader(this.d.prompt)
          await flashPackage(dfu, pkg, this.d.clock, this.d.log, (pct) => this.d.onProgress?.('flash', pct))
          link = await this.d.connector.reopenFrames(REOPEN_TIMEOUT_MS)
        })
      } else this.skip(res, 'flash')

      if (p.wipe_first) {
        await this.step(res, 'wipe', async () => {
          await new CompanionClient(link!).ok(cmd.factoryReset(), 'factory reset')
          await link!.close()
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
          const { pkg } = await this.d.firmware.load(p.firmware_variant, o.firmwareVersion)
          await link!.close()
          const dfu = await this.d.connector.openBootloader(this.d.prompt)
          await flashPackage(dfu, pkg, this.d.clock, this.d.log, (pct) => this.d.onProgress?.('flash', pct))
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

  private start(name: string, kind: 'companion' | 'tracker'): NodeResult {
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
