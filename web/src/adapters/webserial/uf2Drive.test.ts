import { pickUf2Drive } from './uf2Drive'

/** A folder with files in memory. `vanishOnWrite` mimics the bootloader dropping the drive as it reboots. */
class FakeDir {
  name = 'T1000-E'
  files = new Map<string, Uint8Array>()
  failWrite = false
  vanishOnWrite = false
  constructor(marker = true) {
    if (marker) this.files.set('INFO_UF2.TXT', new Uint8Array())
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name) && !opts?.create) throw new DOMException('nope', 'NotFoundError')
    return {
      createWritable: async () => ({
        write: async (b: Uint8Array) => {
          if (this.failWrite) throw new Error('disk error')
          this.files.set(name, b)
          if (this.vanishOnWrite) {
            this.files.clear()
            throw new Error('device gone')
          }
        },
        close: async () => {},
      }),
    }
  }
}
const pick = (d: FakeDir) => async () => d as unknown as FileSystemDirectoryHandle

describe('pickUf2Drive', () => {
  it('refuses a folder that is not a UF2 bootloader drive', async () => {
    await expect(pickUf2Drive(pick(new FakeDir(false)))).rejects.toThrow(/not a UF2 bootloader drive/)
  })

  it('writes the file to the drive', async () => {
    const dir = new FakeDir()
    const drive = await pickUf2Drive(pick(dir))
    await drive.write('fw.uf2', Uint8Array.of(1, 2, 3))
    expect(Array.from(dir.files.get('fw.uf2')!)).toEqual([1, 2, 3])
  })

  it('counts a write that fails because the drive vanished as flashed', async () => {
    const dir = new FakeDir()
    dir.vanishOnWrite = true
    const drive = await pickUf2Drive(pick(dir))
    await expect(drive.write('fw.uf2', Uint8Array.of(1))).resolves.toBeUndefined()
  })

  it('reports a write that fails while the drive is still there', async () => {
    const dir = new FakeDir()
    dir.failWrite = true
    const drive = await pickUf2Drive(pick(dir))
    await expect(drive.write('fw.uf2', Uint8Array.of(1))).rejects.toThrow(/could not write fw.uf2/)
  })
})
