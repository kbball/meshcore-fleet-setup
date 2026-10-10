import { FrameDecoder, encodeFrame } from '../../domain/companion'
import { concat, utf8 } from '../../domain/bytes'
import type { DfuLink, FrameLink, LineLink } from '../../app/ports'
import { Inbox } from './inbox'
import { SerialPump } from './pump'

export const BAUD = 115200

export async function openFrameLink(port: SerialPort): Promise<FrameLink> {
  const inbox = new Inbox<Uint8Array>()
  const decoder = new FrameDecoder()
  const pump = new SerialPump(port, (chunk) => decoder.push(chunk).forEach((f) => inbox.push(f)))
  await pump.open(BAUD)
  return {
    send: (payload) => pump.write(encodeFrame(payload)),
    receive: (t) => inbox.take(t),
    drain: async () => inbox.clear(),
    close: () => pump.close(),
  }
}

export async function openLineLink(port: SerialPort): Promise<LineLink> {
  const inbox = new Inbox<string>()
  const dec = new TextDecoder()
  let partial = ''
  const pump = new SerialPump(port, (chunk) => {
    partial += dec.decode(chunk, { stream: true })
    const lines = partial.split(/\r?\n/)
    partial = lines.pop() ?? ''
    lines.filter((l) => l !== '').forEach((l) => inbox.push(l))
  })
  await pump.open(BAUD)
  return {
    writeLine: (line) => pump.write(utf8(line + '\n')),
    readLine: (t) => inbox.take(t),
    flush: async () => {
      inbox.clear()
      partial = ''
    },
    close: () => pump.close(),
  }
}

/** Counts 0xC0 delimiters: one ACK packet is everything up to and including the second one. */
export async function openDfuLink(port: SerialPort): Promise<DfuLink> {
  const inbox = new Inbox<Uint8Array>()
  let buf: Uint8Array = new Uint8Array(0)
  const pump = new SerialPump(port, (chunk) => {
    buf = concat(buf, chunk)
    for (;;) {
      const first = buf.indexOf(0xc0)
      if (first < 0) return void (buf = new Uint8Array(0))
      const second = buf.indexOf(0xc0, first + 1)
      if (second < 0) return void (buf = buf.subarray(first))
      if (second === first + 1) {
        buf = buf.subarray(second) // back-to-back delimiters: the second starts the next packet
        continue
      }
      inbox.push(buf.slice(first, second + 1))
      buf = buf.subarray(second + 1)
    }
  })
  await pump.open(BAUD)
  return {
    write: (b) => pump.write(b),
    readAck: (t) => inbox.take(t),
    close: () => pump.close(),
  }
}

/** 1200 baud open+close: Adafruit nRF52 boards reset into their bootloader. */
export async function touch1200(port: SerialPort): Promise<void> {
  await port.open({ baudRate: 1200 })
  await new Promise((r) => setTimeout(r, 100))
  await port.close()
}
