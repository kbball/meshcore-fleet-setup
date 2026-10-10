import type { Uf2Drive } from '../../app/ports'

type DirectoryPicker = (opts: { mode: 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>

/** Chrome's folder picker (File System Access API). Not in the TypeScript DOM lib. */
export const browserDirectoryPicker = (): DirectoryPicker => {
  const pick = (globalThis as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
  if (!pick) throw new Error('this browser cannot write to a drive; use Chrome or Edge on a desktop')
  return pick.bind(globalThis)
}

const MARKER = 'INFO_UF2.TXT' // every UF2 bootloader drive has it

const exists = (dir: FileSystemDirectoryHandle, name: string) =>
  dir.getFileHandle(name).then(
    () => true,
    () => false,
  )

/**
 * Asks the operator to choose the bootloader drive (must be called from a click) and checks it really is one,
 * so a wrong folder is refused before anything is written.
 */
export async function pickUf2Drive(pick: DirectoryPicker = browserDirectoryPicker()): Promise<Uf2Drive> {
  const dir = await pick({ mode: 'readwrite', id: 'uf2-drive' })
  if (!(await exists(dir, MARKER)))
    throw new Error(
      `'${dir.name}' is not a UF2 bootloader drive (no ${MARKER}); choose the drive that appeared`,
    )
  return {
    async write(filename, contents) {
      try {
        const w = await (await dir.getFileHandle(filename, { create: true })).createWritable()
        await w.write(contents as BufferSource)
        await w.close()
      } catch (e) {
        // The bootloader reboots into the new firmware the moment the last block arrives and the drive goes
        // away, which can fail the write or the close. A drive that is gone means the flash took.
        if (await exists(dir, MARKER))
          throw new Error(`could not write ${filename} to '${dir.name}'`, { cause: e })
      }
    },
  }
}
