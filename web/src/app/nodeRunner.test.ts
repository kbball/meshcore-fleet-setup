import { FakeCompanionLink, freshCompanionState } from '../adapters/memory/fakeCompanion'
import {
  FakeClock,
  FakeConnector,
  MemoryBatchStore,
  MemoryFirmware,
  MemorySink,
  PlainCipher,
  silentLogger,
} from '../adapters/memory/fakes'
import { FakeTrackerLink } from '../adapters/memory/fakeTracker'
import { bytesToHex } from '../domain/bytes'
import type { CompanionProfile, TrackerProfile } from '../domain/profile'
import { Batch, resultsCsv } from './batch'
import { backupFilename, captureBackup, restoreBackup } from './backup'
import { CompanionClient } from './companionClient'
import { NodeRunner, type RunnerDeps } from './nodeRunner'
import { restoreNode } from './restoreNode'

const secret = '00112233445566778899aabbccddeeff'
const profile: CompanionProfile = {
  kind: 'companion',
  firmware_variant: 'Xiao_nrf52_companion_radio_usb_ble',
  wipe_first: true,
  radio: { freq: 910.525, bw: 62.5, sf: 7, cr: 5, tx_power: 20 },
  channels: [
    { name: 'Public', secret: 'public' },
    { name: 'aid3', secret },
  ],
  advert: { name_template: 'AS3-{n}', lat: 33.8, lon: -84.1, flood_scope: { name: 'ga', key: secret } },
  identity: { mode: 'generate' },
  ble_pin: 123456,
  autoadd: { config: 2, max_hops: 3 },
}

function setup(state = freshCompanionState(7)) {
  const node = new FakeCompanionLink(state)
  const connector = new FakeConnector(node)
  const firmware = new MemoryFirmware()
  const sink = new MemorySink()
  const prompts: string[] = []
  const deps: RunnerDeps = {
    connector,
    firmware,
    cipher: new PlainCipher(),
    sink,
    clock: new FakeClock(),
    log: silentLogger,
    prompt: async (m) => void prompts.push(m),
  }
  return { node, connector, firmware, sink, prompts, deps, runner: new NodeRunner(deps) }
}

describe('companion run', () => {
  it('wipes, configures and verifies a node', async () => {
    const { node, runner, firmware } = setup()
    const r = await runner.runCompanion(profile, { nodeName: 'AS3-4', flash: false })
    expect(r.ok).toBe(true)
    expect(r.steps.map((s) => `${s.step}:${s.status}`)).toEqual([
      'connect:ok',
      'backup:skipped',
      'flash:skipped',
      'wipe:ok',
      'configure:ok',
      'verify:ok',
    ])
    expect(node.resets).toBe(1)
    expect(node.state).toMatchObject({
      name: 'AS3-4',
      sf: 7,
      cr: 5,
      txPower: 20,
      blePin: 123456,
      autoadd: { config: 2, maxHops: 3 },
    })
    expect(node.state.channels.map((c) => c.name)).toEqual(['Public', 'aid3'])
    expect(bytesToHex(node.state.channels[1].secret)).toBe(secret)
    expect(node.state.floodScope?.name).toBe('ga')
    expect(r.publicKey).toBe(bytesToHex(node.state.publicKey))
    expect(firmware.loads).toEqual([])
  })

  it('without wipe_first it writes only what the profile lists', async () => {
    const { node, runner } = setup()
    const before = { ...node.state, channels: [...node.state.channels] }
    const r = await runner.runCompanion(
      {
        kind: 'companion',
        firmware_variant: 'x',
        wipe_first: false,
        radio: { freq: 868, bw: 125, sf: 8, cr: 6 },
      },
      { flash: false },
    )
    expect(r.ok).toBe(true)
    expect(node.resets).toBe(0)
    expect(node.state.sf).toBe(8)
    expect(node.state.name).toBe(before.name)
    expect(node.state.channels).toEqual(before.channels)
    expect(node.state.blePin).toBe(0)
  })

  it('flashes through the bootloader first when asked', async () => {
    const { connector, runner, firmware, prompts } = setup()
    const r = await runner.runCompanion(
      { ...profile, wipe_first: false },
      { nodeName: 'AS3-1', flash: true, firmwareVersion: '2.0.0' },
    )
    expect(r.ok).toBe(true)
    expect(firmware.loads).toEqual(['Xiao_nrf52_companion_radio_usb_ble@2.0.0'])
    expect(connector.bootloaders).toHaveLength(1)
    expect(connector.bootloaders[0].writes.length).toBeGreaterThan(5)
    expect(connector.reopens).toBe(1)
    expect(prompts).toEqual(['press the button'])
  })

  it('backs up first (encrypted) and the file restores to a node', async () => {
    const { node, runner, sink, deps } = setup(freshCompanionState(9))
    node.state.name = 'Bob-Handheld'
    node.state.blePin = 0
    node.state.channels.push({ name: 'club', secret: Uint8Array.from({ length: 16 }, (_, i) => i) })
    const originalKey = bytesToHex(node.state.privateKey)
    const r = await runner.runCompanion(profile, {
      nodeName: 'AS3-1',
      flash: false,
      backup: { passphrase: 'hunter2' },
    })
    expect(r.ok).toBe(true)
    expect(r.backupFile).toMatch(/^backup-Bob-Handheld-[0-9a-f]{8}-2026-10-10\.mcbackup\.json$/)
    expect(JSON.stringify(r)).not.toContain('hunter2')
    expect(JSON.stringify(r)).not.toContain(originalKey)
    expect(node.state.name).toBe('AS3-1')

    // later the owner restores onto the (now wiped and reconfigured) node
    const text = [...sink.files.values()][0]
    await expect(restoreNode(deps, text, 'wrong')).rejects.toThrow(/wrong passphrase/)
    const out = await restoreNode(deps, text, 'hunter2')
    expect(out).toEqual({ name: 'Bob-Handheld', problems: [] })
    expect(node.state.name).toBe('Bob-Handheld')
    expect(node.state.channels.map((c) => c.name)).toEqual(['Public', 'club'])
    expect(bytesToHex(node.state.privateKey)).toBe(originalKey)
  })

  it('a failed backup blocks flashing and wiping', async () => {
    const { node, runner, sink, firmware, connector } = setup()
    sink.fail = true
    const r = await runner.runCompanion(profile, {
      nodeName: 'AS3-1',
      flash: true,
      backup: { passphrase: 'p' },
    })
    expect(r.ok).toBe(false)
    expect(r.steps.at(-1)).toMatchObject({ step: 'backup', status: 'failed', detail: 'download blocked' })
    expect(node.resets).toBe(0)
    expect(firmware.loads).toEqual([])
    expect(connector.bootloaders).toHaveLength(0)
  })

  it('backup needs a passphrase', async () => {
    const { runner } = setup()
    const r = await runner.runCompanion(profile, { flash: false, backup: { passphrase: '' } })
    expect(r.steps.at(-1)?.detail).toMatch(/passphrase/)
  })

  it('records a connect failure', async () => {
    const { runner, deps } = setup()
    const r = await new NodeRunner({ ...deps, connector: new FakeConnector() }).runCompanion(profile, {
      flash: false,
    })
    expect(r.ok).toBe(false)
    expect(r.steps).toEqual([{ step: 'connect', status: 'failed', detail: 'no companion node connected' }])
    expect(runner).toBeDefined()
  })

  it('reports verify mismatches without printing secrets', async () => {
    const { node, runner } = setup()
    const orig = node.send.bind(node)
    node.send = async (p) => {
      await orig(p)
      if (p[0] === 32 && p[1] === 1) node.state.channels[1].secret = new Uint8Array(16).fill(1) // corrupt after write
    }
    const r = await runner.runCompanion(profile, { nodeName: 'AS3-1', flash: false })
    expect(r.ok).toBe(false)
    const d = r.steps.at(-1)!.detail!
    expect(d).toContain('channel 1: secret does not match')
    expect(d).not.toContain(secret)
  })

  it('failed flash stops before wipe', async () => {
    const { runner, firmware, node } = setup()
    firmware.fail = true
    const r = await runner.runCompanion(profile, { flash: true })
    expect(r.steps.at(-1)).toMatchObject({ step: 'flash', status: 'failed' })
    expect(node.resets).toBe(0)
  })
})

describe('gps', () => {
  const gpsProfile = (gps: NonNullable<CompanionProfile['gps']>): CompanionProfile => ({
    kind: 'companion',
    firmware_variant: 'x',
    wipe_first: false,
    gps,
  })

  it('turns GPS on with an interval on a node that has one, and verifies it', async () => {
    const { node, runner } = setup()
    const r = await runner.runCompanion(gpsProfile({ enabled: true, interval_sec: 900 }), { flash: false })
    expect(r.ok).toBe(true)
    expect(node.state.gps).toBe(true)
    expect(node.state.gpsInterval).toBe(900)
  })

  it('turns it off again', async () => {
    const { node, runner } = setup()
    node.state.gps = true
    const r = await runner.runCompanion(gpsProfile({ enabled: false }), { flash: false })
    expect(r.ok).toBe(true)
    expect(node.state.gps).toBe(false)
  })

  it('fails clearly when enabling GPS on a node without one', async () => {
    const { node, runner } = setup()
    node.state.gps = null
    const r = await runner.runCompanion(gpsProfile({ enabled: true }), { flash: false })
    expect(r.ok).toBe(false)
    expect(r.steps.at(-1)).toMatchObject({ step: 'configure', status: 'failed' })
    expect(r.steps.at(-1)?.detail).toMatch(/no GPS/)
    const withInterval = await runner.runCompanion(gpsProfile({ enabled: false, interval_sec: 60 }), {
      flash: false,
    })
    expect(withInterval.steps.at(-1)?.detail).toMatch(/no GPS/)
  })

  it('disabling GPS on a node without one is already true, so it passes', async () => {
    const { node, runner } = setup()
    node.state.gps = null
    expect((await runner.runCompanion(gpsProfile({ enabled: false }), { flash: false })).ok).toBe(true)
  })

  it('a wipe turns GPS off, and the profile can turn it back on', async () => {
    const { node, runner } = setup()
    node.state.gps = true
    const r = await runner.runCompanion(
      { ...gpsProfile({ enabled: true }), wipe_first: true },
      { flash: false },
    )
    expect(r.ok).toBe(true)
    expect(node.resets).toBe(1)
    expect(node.state.gps).toBe(true)
  })

  it('reports a mismatch if the node did not take the setting', async () => {
    const { node, runner } = setup()
    const orig = node.send.bind(node)
    node.send = async (p) => {
      await orig(p)
      if (p[0] === 41) node.state.gps = false // the node ignores the change
    }
    const r = await runner.runCompanion(gpsProfile({ enabled: true }), { flash: false })
    expect(r.steps.at(-1)?.detail).toContain('gps: expected on, node has off')
  })

  it('backs up the GPS state and restores it', async () => {
    const { node, runner, sink, deps } = setup()
    node.state.gps = true
    await runner.runCompanion(
      { kind: 'companion', firmware_variant: 'x', wipe_first: true },
      { flash: false, backup: { passphrase: 'pw' } },
    )
    expect(node.state.gps).toBe(false) // wiped
    const out = await restoreNode(deps, [...sink.files.values()][0], 'pw')
    expect(out.problems).toEqual([])
    expect(node.state.gps).toBe(true)
  })
})

describe('companion client and config edge cases', () => {
  it('maps error replies and disabled commands', async () => {
    const node = new FakeCompanionLink()
    const c = new CompanionClient(node, 50)
    node.failWith[8] = 6
    await expect(c.ok(Uint8Array.of(8, 65), 'set name')).rejects.toThrow(/illegal argument/)
    node.state.privateKeyExport = false
    await expect(c.request(Uint8Array.of(23), 'export')).rejects.toThrow(/disabled/)
    node.failWith[8] = 99
    await expect(c.ok(Uint8Array.of(8, 65), 'set name')).rejects.toThrow(/error 99/)
    await expect(c.ok(Uint8Array.of(22, 3), 'device query')).rejects.toThrow(/unexpected reply code/)
  })

  it('times out on silence', async () => {
    const node = new FakeCompanionLink()
    node.receive = async () => null
    await expect(new CompanionClient(node, 20).request(Uint8Array.of(22, 3), 'q')).rejects.toThrow(/timeout/)
  })

  it('backup of a firmware with key export disabled says so', async () => {
    const node = new FakeCompanionLink()
    node.state.privateKeyExport = false
    const b = await captureBackup(new CompanionClient(node), new FakeClock(), 'x')
    expect(b.not_captured.some((m) => m.startsWith('private key'))).toBe(true)
    const problems = await restoreBackup(new CompanionClient(node), b, {
      clock: new FakeClock(),
      log: silentLogger,
    })
    expect(problems).toEqual(['private key was not in the backup, so the node keeps a different identity'])
    expect(backupFilename({ ...b, name: '' })).toMatch(/^backup-node-/)
  })

  it('a clock that is ahead of the host is tolerated', async () => {
    const { node, runner } = setup()
    node.state.time = 4_000_000_000
    const r = await runner.runCompanion(
      {
        kind: 'companion',
        firmware_variant: 'x',
        wipe_first: false,
        radio: { freq: 868, bw: 125, sf: 8, cr: 6 },
      },
      { flash: false },
    )
    expect(r.ok).toBe(true)
  })

  it('a channel slot beyond the node is an error', async () => {
    const { runner } = setup()
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `c${i}`, secret }))
    const r = await runner.runCompanion(
      { kind: 'companion', firmware_variant: 'x', wipe_first: false, channels: many },
      { flash: false },
    )
    expect(r.steps.at(-1)).toMatchObject({ step: 'configure', status: 'failed' })
  })
})

describe('tracker run', () => {
  const tp: TrackerProfile = {
    kind: 'tracker',
    firmware_variant: 't1000e_gps_tracker',
    name_template: 'Sweep{n}',
    config: { channel_name: 'race', channel_psk: 'SECRET==', interval_sec: 600, sf: 7 },
  }

  it('provisions and verifies', async () => {
    const link = new FakeTrackerLink()
    const connector = new FakeConnector(undefined, link)
    const runner = new NodeRunner({ ...setup().deps, connector })
    const r = await runner.runTracker(tp, { nodeName: 'Sweep2', flash: false })
    expect(r.ok).toBe(true)
    expect(link.settings).toMatchObject({ name: 'Sweep2', interval: '600', channel: 'race' })
    expect(link.rebooted).toBe(true)
    expect(JSON.stringify(r)).not.toContain('SECRET')
  })

  it('flashes first when asked', async () => {
    const link = new FakeTrackerLink()
    const connector = new FakeConnector(undefined, link)
    const deps = { ...setup().deps, connector }
    const r = await new NodeRunner(deps).runTracker(tp, { nodeName: 'Sweep2', flash: true })
    expect(r.ok).toBe(true)
    expect(connector.bootloaders).toHaveLength(1)
    expect(connector.reopens).toBe(1)
  })

  it('fails cleanly when the device is not a tracker', async () => {
    const link = new FakeTrackerLink({}, { noAnswer: true })
    const deps = { ...setup().deps, connector: new FakeConnector(undefined, link), trackerTimeoutMs: 30 }
    const r = await new NodeRunner(deps).runTracker(tp, { flash: false })
    expect(r.ok).toBe(false)
    expect(r.steps.at(-1)?.step).toBe('configure')
  })
})

describe('batch', () => {
  it('numbers nodes from the template and only advances on success', async () => {
    const { runner, node } = setup()
    const store = new MemoryBatchStore()
    const batch = new Batch(runner, store)
    expect(batch.nextName(profile)).toBe('AS3-1')
    const ok = await batch.runNext(profile, { flash: false })
    expect(ok.ok).toBe(true)
    expect(batch.counter).toBe(2)
    expect(node.state.name).toBe('AS3-1')

    node.failWith[11] = 6 // radio params rejected
    const bad = await batch.runNext({ ...profile, wipe_first: false }, { flash: false })
    expect(bad.ok).toBe(false)
    expect(batch.counter).toBe(2)
    expect(store.state.results).toHaveLength(2)

    // a reload picks up where it left off
    expect(new Batch(runner, store).counter).toBe(2)
  })

  it('runs tracker profiles and unnamed profiles, supports counter edits and clear', async () => {
    const link = new FakeTrackerLink()
    const deps = { ...setup().deps, connector: new FakeConnector(undefined, link) }
    const batch = new Batch(new NodeRunner(deps), new MemoryBatchStore())
    const tp: TrackerProfile = {
      kind: 'tracker',
      firmware_variant: 'x',
      name_template: 'Sweep{n}',
      config: { sf: 7 },
    }
    batch.setCounter(5)
    expect(batch.nextName(tp)).toBe('Sweep5')
    expect((await batch.runNext(tp, { flash: false })).name).toBe('Sweep5')
    expect(batch.counter).toBe(6)
    expect(batch.nextName({ kind: 'companion', firmware_variant: 'x', wipe_first: false })).toBeUndefined()
    expect(() => batch.setCounter(0)).toThrow(/positive/)
    batch.clear()
    expect(batch.results).toHaveLength(0)
    expect(batch.counter).toBe(1)
  })

  it('renders a CSV without secrets', async () => {
    const { runner } = setup()
    const batch = new Batch(runner, new MemoryBatchStore())
    await batch.runNext(profile, { flash: false })
    const csv = resultsCsv(batch.results)
    expect(csv.split('\n')[0]).toBe('time,name,kind,public_key,result,steps,backup_file,error')
    expect(csv).toContain('"AS3-1","companion"')
    expect(csv).not.toContain(secret)
  })
})
