// Composition root: builds adapters and use cases. No logic here.
import { DownloadSink } from './adapters/browser/download'
import { HttpFirmwareInfo, HttpFirmwareSource } from './adapters/browser/firmwareSource'
import { RingLogger } from './adapters/browser/logger'
import { LocalBatchStore } from './adapters/browser/resultsStore'
import { WebCryptoBackupCipher } from './adapters/crypto/backupCipher'
import { WebSerialConnector } from './adapters/webserial/connector'
import { Batch } from './app/batch'
import { NodeRunner } from './app/nodeRunner'
import type { Clock, Prompt } from './app/ports'

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

export type App = ReturnType<typeof buildApp>

export function buildApp(prompt: Prompt, onProgress: (step: string, pct: number) => void) {
  const logger = new RingLogger()
  const cipher = new WebCryptoBackupCipher()
  const connector = new WebSerialConnector()
  const manifestUrl = import.meta.env.VITE_MANIFEST_URL ?? './firmware/manifest.json'
  const firmwareInfo = new HttpFirmwareInfo(manifestUrl)
  const runner = new NodeRunner({
    connector,
    firmware: new HttpFirmwareSource(manifestUrl),
    cipher,
    sink: new DownloadSink(),
    clock: systemClock,
    log: logger,
    prompt,
    onProgress,
  })
  const batch = new Batch(runner, new LocalBatchStore())
  return { logger, cipher, connector, runner, batch, firmwareInfo }
}
