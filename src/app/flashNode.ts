import {
  DFU_PACKET_MAX_SIZE,
  HciPacketizer,
  FLASH_PAGE_WRITE_TIME_MS,
  activateWaitMs,
  dfuPayloads,
  eraseWaitMs,
  parseAck,
  type DfuPackage,
} from '../domain/dfu'
import type { Clock, DfuLink, Logger } from './ports'

export class DfuError extends Error {}

const ACK_TIMEOUT_MS = 1000

/** Upload an application-only DFU package to the Adafruit nRF52 bootloader (single bank). */
export async function flashPackage(
  link: DfuLink,
  pkg: DfuPackage,
  clock: Clock,
  log: Logger,
  onProgress: (pct: number) => void = () => {},
): Promise<void> {
  const hci = new HciPacketizer()

  const send = async (payload: Uint8Array) => {
    const packet = hci.packet(payload)
    await link.write(packet)
    const ack = await link.readAck(ACK_TIMEOUT_MS)
    if (ack === null) {
      hci.reset()
      throw new DfuError('timed out waiting for the bootloader to acknowledge a packet')
    }
    parseAck(ack) // validates the SLIP framing; the reference tool does not retry on a bad number either
  }

  log.info('dfu start', { size: pkg.bin.length })
  await send(dfuPayloads.start(pkg.bin.length))
  await clock.sleep(eraseWaitMs(pkg.bin.length))

  await send(dfuPayloads.init(pkg.dat))

  const chunks = Math.ceil(pkg.bin.length / DFU_PACKET_MAX_SIZE)
  for (let i = 0; i < chunks; i++) {
    await send(dfuPayloads.data(pkg.bin.subarray(i * DFU_PACKET_MAX_SIZE, (i + 1) * DFU_PACKET_MAX_SIZE)))
    onProgress(Math.floor(((i + 1) / chunks) * 100))
    // the bootloader erases/writes a page every 8 packets and its CPU is blocked meanwhile
    if (i % 8 === 0) await clock.sleep(FLASH_PAGE_WRITE_TIME_MS)
  }
  await clock.sleep(FLASH_PAGE_WRITE_TIME_MS)
  await send(dfuPayloads.stop())

  log.info('dfu activate')
  await clock.sleep(activateWaitMs())
  await link.close()
}
