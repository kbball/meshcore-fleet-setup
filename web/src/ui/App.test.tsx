import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RingLogger } from '../adapters/browser/logger'
import { FakeCompanionLink, freshCompanionState } from '../adapters/memory/fakeCompanion'
import {
  FakeClock,
  FakeConnector,
  MemoryBatchStore,
  MemoryFirmware,
  MemorySink,
  PlainCipher,
} from '../adapters/memory/fakes'
import { Batch } from '../app/batch'
import { NodeRunner } from '../app/nodeRunner'
import type { Prompt } from '../app/ports'
import type { buildApp } from '../wiring'
import { App } from './App'

const secret = '00112233445566778899aabbccddeeff'
const companion = {
  kind: 'companion',
  firmware_variant: 'x',
  wipe_first: true,
  radio: { freq: 910.525, bw: 62.5, sf: 7, cr: 5 },
  channels: [{ name: 'aid', secret }],
  advert: { name_template: 'AS3-{n}' },
}

function fakeFactory() {
  const node = new FakeCompanionLink(freshCompanionState(3))
  const connector = new FakeConnector(node)
  const sink = new MemorySink()
  const logger = new RingLogger(50, { info() {}, warn() {}, error() {} })
  const cipher = new PlainCipher()
  let prompt!: Prompt
  const factory = ((p: Prompt) => {
    prompt = p
    const runner = new NodeRunner({
      connector,
      firmware: new MemoryFirmware(),
      cipher,
      sink,
      clock: new FakeClock(),
      log: logger,
      prompt: p,
    })
    return { logger, cipher, connector, runner, batch: new Batch(runner, new MemoryBatchStore()) }
  }) as unknown as typeof buildApp
  return { factory, node, sink, connector, ask: (m: string) => prompt(m) }
}

const upload = (label: RegExp, json: unknown, name = 'profile.json') =>
  fireEvent.change(screen.getByLabelText(label), {
    target: {
      files: [
        new File([typeof json === 'string' ? json : JSON.stringify(json)], name, {
          type: 'application/json',
        }),
      ],
    },
  })

describe('App', () => {
  it('shows the version and warns when Web Serial is missing', () => {
    render(<App version="1.2.3" factory={fakeFactory().factory} />)
    expect(screen.getByText('v1.2.3')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Web Serial is not available')
  })

  it('rejects an invalid profile with the reasons', async () => {
    render(<App version="1" factory={fakeFactory().factory} />)
    upload(/profile file/i, { kind: 'companion' })
    expect(await screen.findByText(/invalid profile/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /run next node/i })).not.toBeInTheDocument()
  })

  it('runs the next node, names it from the counter, and logs the result', async () => {
    const f = fakeFactory()
    render(<App version="1" factory={f.factory} />)
    upload(/profile file/i, companion)
    expect(await screen.findByText(/wipes each node first/)).toBeInTheDocument()
    expect(screen.getByText(/contains keys/)).toBeInTheDocument()
    expect(screen.getByText('AS3-1')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText(/flash firmware/i)) // off
    await userEvent.click(screen.getByRole('button', { name: /run next node/i }))
    expect(await screen.findByRole('status')).toHaveTextContent('AS3-1: done')
    expect(f.node.state.name).toBe('AS3-1')
    expect(f.connector.released).toBe(1)
    expect(screen.getByText('AS3-2')).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveTextContent('AS3-1')
    expect(screen.getByLabelText('log').textContent).toContain('companion configure')

    fireEvent.change(screen.getByLabelText(/counter/i), { target: { value: '9' } })
    expect(screen.getByText('AS3-9')).toBeInTheDocument()

    URL.createObjectURL = vi.fn(() => 'blob:csv')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await userEvent.click(screen.getByRole('button', { name: /download csv/i }))
    expect(click).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /clear log/i }))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('requires a passphrase for a backup, saves it and offers mail', async () => {
    const f = fakeFactory()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<App version="1" factory={f.factory} />)
    upload(/profile file/i, companion)
    await screen.findByText(/wipes each node first/)
    await userEvent.click(screen.getByLabelText(/flash firmware/i))
    await userEvent.click(screen.getByLabelText(/back up this node first/i))
    const run = screen.getByRole('button', { name: /run next node/i })
    expect(run).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/backup passphrase/i), 'pw')
    await userEvent.type(screen.getByLabelText(/owner email/i), 'owner@example.com')
    expect(run).toBeEnabled()
    await userEvent.click(run)
    await waitFor(() => expect(f.sink.files.size).toBe(1))
    await waitFor(() => expect(open).toHaveBeenCalled())
    expect(String(open.mock.calls[0][0])).toContain('mailto:owner%40example.com')
  })

  it('shows a failed run and a connection error', async () => {
    const f = fakeFactory()
    render(<App version="1" factory={f.factory} />)
    upload(/profile file/i, { ...companion, wipe_first: false })
    await screen.findByText(/no wipe/)
    await userEvent.click(screen.getByLabelText(/flash firmware/i))
    f.node.failWith[11] = 6
    await userEvent.click(screen.getByRole('button', { name: /run next node/i }))
    expect(await screen.findByRole('status')).toHaveTextContent('FAILED')
    expect(screen.getByRole('table')).toHaveTextContent('illegal argument')
    expect(screen.getByRole('strong')).toHaveTextContent('AS3-1') // counter did not advance
  })

  it('asks the operator to act and continues when they click', async () => {
    const f = fakeFactory()
    render(<App version="1" factory={f.factory} />)
    const done = f.ask('Press the button')
    expect(await screen.findByRole('dialog')).toHaveTextContent('Press the button')
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    await done
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('restores a backup file onto the connected node', async () => {
    const f = fakeFactory()
    render(<App version="1" factory={f.factory} />)
    upload(/profile file/i, companion)
    await screen.findByText(/wipes each node first/)
    f.node.state.name = 'Bob'
    await userEvent.click(screen.getByLabelText(/flash firmware/i))
    await userEvent.click(screen.getByLabelText(/back up this node first/i))
    await userEvent.type(screen.getByLabelText(/backup passphrase/i), 'pw')
    await userEvent.click(screen.getByRole('button', { name: /run next node/i }))
    await waitFor(() => expect(f.sink.files.size).toBe(1))
    await screen.findByText(/AS3-1: done/)
    const file = [...f.sink.files.values()][0]

    upload(/backup file/i, file, 'b.json')
    await userEvent.type(screen.getByLabelText(/^passphrase/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /restore to connected node/i }))
    expect(await screen.findByText(/wrong passphrase/)).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText(/^passphrase/i))
    await userEvent.type(screen.getByLabelText(/^passphrase/i), 'pw')
    await userEvent.click(screen.getByRole('button', { name: /restore to connected node/i }))
    expect(await screen.findByText('Restored Bob.')).toBeInTheDocument()
    expect(f.node.state.name).toBe('Bob')
  })
})

describe('App tabs', () => {
  it('builds a profile in the builder and uses it for the batch', async () => {
    render(<App version="1" factory={fakeFactory().factory} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Profile builder' }))
    expect(screen.getByRole('tab', { name: 'Profile builder' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Use for the batch' }))
    expect(screen.getByRole('tab', { name: 'Run a batch' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText(/wipes each node first/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run next node/i })).toBeInTheDocument()
  })
})

describe('App event tab', () => {
  it('creates an event, keeps it across tabs and hands a station profile to the batch', async () => {
    render(<App version="1" factory={fakeFactory().factory} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Event' }))
    await userEvent.type(screen.getByLabelText('Event name'), 'ARES 100')
    await userEvent.click(screen.getByRole('button', { name: 'Generate keys and create' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Run a batch' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Event' }))
    expect(screen.getByText('ARES 100')).toBeInTheDocument() // survived the tab switch

    await userEvent.click(screen.getByRole('button', { name: 'Use gateway profile for AS1' }))
    expect(screen.getByText('gateway')).toBeInTheDocument()
    expect(screen.getByText(/RAK_4631_companion_radio_usb_ethernet/)).toBeInTheDocument()
  })
})
