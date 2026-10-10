import type { BackupSink } from '../../app/ports'

/** Saves a file through the browser's download mechanism. */
export class DownloadSink implements BackupSink {
  async save(filename: string, contents: string): Promise<void> {
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

/** Opens the mail client with the recipient and subject filled in. Browsers cannot attach files to mailto. */
export function mailtoUrl(to: string, nodeName: string, filename: string): string {
  const subject = `Your MeshCore node backup (${nodeName})`
  const body = `Your node's configuration backup is attached (${filename}).\n\nIt is encrypted. You will need the passphrase you were given to restore it.`
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
