import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { downloadText } from '../adapters/browser/download'
import { createEventFile, type EventFile } from '../domain/event'
import { parseProfile, type Profile } from '../domain/profile'
import { EventPanel, parseStationLines } from './EventPanel'

vi.mock('../adapters/browser/download', () => ({ downloadText: vi.fn() }))

let n = 1
const random = (len: number) => {
  const b = new Uint8Array(len)
  new DataView(b.buffer).setUint32(0, n++ * 2654435761)
  b[len - 1] = n
  return b
}
const fixedNow = () => new Date('2026-10-10T12:00:00Z')

function Harness({ initial = null, onUse }: { initial?: EventFile | null; onUse: (p: Profile) => void }) {
  const [ev, setEv] = useState<EventFile | null>(initial)
  return <EventPanel event={ev} setEvent={setEv} onUse={onUse} random={random} now={fixedNow} />
}

const sample = () =>
  createEventFile(
    {
      name: 'ARES 100',
      firmware_tag: 'ares-v1.0.0',
      radio: { freq: 910.525, bw: 62.5, sf: 7, cr: 5, tx_power: 20 },
      stationIds: [
        { id: 'AS1', name: 'Aid Station 1' },
        { id: 'AS2', name: 'Aid Station 2' },
      ],
      trackers: { name_template: 'Sweep{n}', count: 6 },
      created: '2026-10-10T12:00:00Z',
    },
    random,
  )

beforeEach(() => vi.mocked(downloadText).mockClear())

describe('parseStationLines', () => {
  it('reads ID and name, skipping blanks', () => {
    expect(parseStationLines('AS1 Aid Station 1\n\n  AS2  \n')).toEqual([
      { id: 'AS1', name: 'Aid Station 1' },
      { id: 'AS2', name: 'AS2' },
    ])
  })
})

describe('creating an event', () => {
  it('generates keys and shows the stations with their channel indexes', async () => {
    render(<Harness onUse={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Event name'), 'ARES 100')
    await userEvent.type(screen.getByLabelText(/BLE PIN/), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Generate keys and create' }))
    expect(screen.getByText('ARES 100')).toBeInTheDocument()
    expect(screen.getByText(/2 stations, 6 channels/)).toBeInTheDocument()
    expect(screen.getByLabelText('channels AS1').textContent).toBe(
      '0  Sweeps\n1  AS1 Log\n2  AS1 Chat\n3  All Race',
    )
  })

  it('reports invalid input instead of creating', async () => {
    render(<Harness onUse={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Generate keys and create' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/)
    expect(screen.queryByText(/channels$/)).not.toBeInTheDocument()
  })

  it('imports an event file, and reports a bad one', async () => {
    render(<Harness onUse={vi.fn()} />)
    const input = screen.getByLabelText(/Event file/)
    await userEvent.upload(input, new File(['{'], 'bad.json', { type: 'application/json' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not valid JSON/))
    await userEvent.upload(
      input,
      new File([JSON.stringify(sample())], 'event.json', { type: 'application/json' }),
    )
    await waitFor(() => expect(screen.getByText('ARES 100')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ignores an empty file selection', () => {
    render(<Harness onUse={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Event file/), { target: { files: [] } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('with an event', () => {
  it('uses derived profiles for the batch', async () => {
    const onUse = vi.fn()
    render(<Harness initial={sample()} onUse={onUse} />)
    await userEvent.click(screen.getByRole('button', { name: 'Use radio profile for AS1' }))
    expect(onUse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'companion' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use gateway profile for AS2' }))
    expect(onUse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'gateway' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use tracker profile' }))
    expect(onUse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'tracker' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use net-control profile' }))
    expect(onUse.mock.lastCall![0].channels).toHaveLength(6)
  })

  it('downloads the event file, station bundle and profiles', async () => {
    const ev = sample()
    render(<Harness initial={ev} onUse={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Download event file' }))
    expect(downloadText).toHaveBeenLastCalledWith(
      'event-ARES-100.json',
      expect.stringContaining(ev.sweeps_secret),
      'application/json',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Download AS1 bundle' }))
    const [name, text] = vi.mocked(downloadText).mock.lastCall!
    expect(name).toBe('station-AS1.json')
    expect(text).toContain(ev.stations[0].log_secret)
    expect(text).not.toContain(ev.stations[1].log_secret)
    // The bundle is a wrapper for handing a station its files, not a profile: the importers say so.
    expect(() => parseProfile(text)).toThrow(/station bundle, not a profile/)

    // The per-station profile downloads are real profile files that the importers (profile builder, batch) accept.
    await userEvent.click(screen.getByRole('button', { name: 'Download radio profile for AS1' }))
    let [pname, ptext] = vi.mocked(downloadText).mock.lastCall!
    expect(pname).toBe('station-AS1-radio.json')
    expect(parseProfile(ptext).kind).toBe('companion')
    expect(ptext).toContain(ev.stations[0].log_secret)
    expect(ptext).not.toContain(ev.stations[1].log_secret)
    await userEvent.click(screen.getByRole('button', { name: 'Download gateway profile for AS1' }))
    ;[pname, ptext] = vi.mocked(downloadText).mock.lastCall!
    expect(pname).toBe('station-AS1-gateway.json')
    expect(parseProfile(ptext).kind).toBe('gateway')

    await userEvent.click(screen.getByRole('button', { name: 'Download tracker profile' }))
    expect(vi.mocked(downloadText).mock.lastCall![0]).toBe('tracker-profile.json')
    await userEvent.click(screen.getByRole('button', { name: 'Download net-control profile' }))
    expect(vi.mocked(downloadText).mock.lastCall![0]).toBe('net-control-profile.json')
  })

  it('shows go-box settings with the address and the DHCP reminder, never secrets', async () => {
    const ev = sample()
    render(<Harness initial={ev} onUse={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('gateway address AS1'), '10.0.1.9')
    await userEvent.click(screen.getByRole('button', { name: 'Go-box settings AS1' }))
    const pre = screen.getByLabelText('go-box AS1')
    expect(pre.textContent).toContain('MESHCORE_ADDRESS=10.0.1.9')
    expect(pre.textContent).toContain('MESHCORE_CHANNEL_INDEX=1')
    expect(pre.textContent).toContain('SWEEP_MESHCORE_CHANNEL=0')
    expect(pre.textContent).not.toContain(ev.sweeps_secret)
    expect(screen.getByText(/Reserve it by MAC/)).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('gateway address AS1'))
    expect(screen.getByLabelText('go-box AS1').textContent).toContain('MESHCORE_ADDRESS=\n')
    await userEvent.click(screen.getByRole('button', { name: 'Go-box settings AS1' }))
    expect(screen.queryByLabelText('go-box AS1')).not.toBeInTheDocument()
  })

  it('adds, rotates and removes stations', async () => {
    const ev = sample()
    render(<Harness initial={ev} onUse={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('New station ID'), 'AS3')
    await userEvent.click(screen.getByRole('button', { name: 'Add station' }))
    expect(screen.getByLabelText('station AS3')).toBeInTheDocument()
    expect(screen.getByText(/3 stations, 8 channels/)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('New station ID'), 'AS3')
    await userEvent.click(screen.getByRole('button', { name: 'Add station' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/used twice/)

    await userEvent.click(screen.getByRole('button', { name: 'Rotate keys AS1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Download event file' }))
    const saved = JSON.parse(vi.mocked(downloadText).mock.lastCall![1])
    expect(saved.stations[0].log_secret).not.toBe(ev.stations[0].log_secret)
    expect(saved.stations[1]).toEqual(ev.stations[1])

    await userEvent.click(screen.getByRole('button', { name: 'Remove AS3' }))
    expect(screen.queryByLabelText('station AS3')).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('station AS1')).getByText('AS1')).toBeInTheDocument()
  })

  it('lists tracker names and closes the event', async () => {
    render(<Harness initial={sample()} onUse={vi.fn()} />)
    expect(screen.getByText(/Sweep1, Sweep2, Sweep3, Sweep4 … Sweep6/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close event' }))
    expect(screen.getByRole('button', { name: 'Generate keys and create' })).toBeInTheDocument()
  })

  it('reports a derivation failure instead of throwing', async () => {
    const ev = { ...sample(), ble_pin: 5 }
    const onUse = vi.fn()
    render(<Harness initial={ev} onUse={onUse} />)
    await userEvent.click(screen.getByRole('button', { name: 'Use radio profile for AS1' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/derived profile is invalid/)
    expect(onUse).not.toHaveBeenCalled()
  })
})
