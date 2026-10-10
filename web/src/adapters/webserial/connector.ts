import type { DfuLink, FrameLink, LineLink, NodeConnector, Prompt, Uf2Drive } from '../../app/ports'
import { openDfuLink, openFrameLink, openLineLink, touch1200 } from './links'
import { pickUf2Drive } from './uf2Drive'

type Info = { usbVendorId?: number; usbProductId?: number }
const sameInfo = (a: Info, b: Info) => a.usbVendorId === b.usbVendorId && a.usbProductId === b.usbProductId
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Web Serial implementation of NodeConnector. NOT verified on hardware yet: the 1200 baud touch,
 * bootloader port discovery and re-enumeration after reboot all depend on how Chrome and each board's
 * USB stack behave. Prompts the operator when it cannot find the port by itself.
 */
export class WebSerialConnector implements NodeConnector {
  private port: SerialPort | null = null
  private appInfo: Info | null = null

  constructor(
    private serial: Serial = navigator.serial,
    private bootloaderWaitMs = 5000,
    private pickDrive: typeof pickUf2Drive = pickUf2Drive,
  ) {}

  private async current(): Promise<SerialPort> {
    if (!this.port) {
      this.port = await this.serial.requestPort()
      this.appInfo = this.port.getInfo()
    }
    return this.port
  }

  async openFrames(): Promise<FrameLink> {
    return openFrameLink(await this.current())
  }

  async openLines(): Promise<LineLink> {
    return openLineLink(await this.current())
  }

  async openBootloader(prompt: Prompt): Promise<DfuLink> {
    const app = await this.current()
    try {
      await touch1200(app)
    } catch {
      // not every board supports the touch; fall through to the manual path
    }
    this.port = await this.waitForPort(
      (p) => !sameInfo(p.getInfo(), this.appInfo ?? {}),
      this.bootloaderWaitMs,
    )
    if (!this.port) {
      await prompt(
        'Put the node in bootloader mode (double-tap reset, or hold the button while plugging in), then click Continue and choose the bootloader port.',
      )
      this.port = await this.serial.requestPort()
    }
    return openDfuLink(this.port)
  }

  async openUf2Drive(prompt: Prompt): Promise<Uf2Drive> {
    if (this.port) {
      try {
        await touch1200(this.port) // some bootloaders honour it; the T-1000-E may not
      } catch {
        // fall through to the manual path
      }
    }
    await prompt(
      'Put the board in bootloader mode: double-click its button (or hold it while plugging in USB) until a drive named like T1000-E appears. Then click Continue and choose that drive.',
    )
    return this.pickDrive()
  }

  async reopenFrames(timeoutMs: number): Promise<FrameLink> {
    return openFrameLink(await this.back(timeoutMs))
  }

  async reopenLines(timeoutMs: number): Promise<LineLink> {
    return openLineLink(await this.back(timeoutMs))
  }

  async release(): Promise<void> {
    this.port = null
    this.appInfo = null
  }

  /** Wait for the node to re-enumerate with the application's USB ids. */
  private async back(timeoutMs: number): Promise<SerialPort> {
    const p = await this.waitForPort((x) => sameInfo(x.getInfo(), this.appInfo ?? {}), timeoutMs)
    if (!p) throw new Error('the node did not come back on USB in time')
    this.port = p
    await sleep(500) // let the CDC interface settle
    return p
  }

  private async waitForPort(
    match: (p: SerialPort) => boolean,
    timeoutMs: number,
  ): Promise<SerialPort | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const ports = await this.serial.getPorts()
      const hit = ports.find((p) => match(p) && !p.readable)
      if (hit) return hit
      await sleep(300)
    }
    return null
  }
}
