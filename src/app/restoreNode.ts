import { restoreBackup } from './backup'
import { CompanionClient } from './companionClient'
import type { BackupCipher, Clock, Logger, NodeConnector } from './ports'

/** Decrypt a backup file and write it to the node that is plugged in. Resolves with mismatches (empty = restored). */
export async function restoreNode(
  d: { connector: NodeConnector; cipher: BackupCipher; clock: Clock; log: Logger },
  fileText: string,
  passphrase: string,
): Promise<{ name: string; problems: string[] }> {
  const backup = await d.cipher.decrypt(fileText, passphrase)
  const link = await d.connector.openFrames()
  try {
    const problems = await restoreBackup(new CompanionClient(link), backup, d)
    return { name: backup.name, problems }
  } finally {
    await link.close().catch(() => {})
  }
}
