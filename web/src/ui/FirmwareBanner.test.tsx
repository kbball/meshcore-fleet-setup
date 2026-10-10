import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryFirmwareInfo } from '../adapters/memory/fakes'
import { FirmwareBanner } from './FirmwareBanner'

describe('FirmwareBanner', () => {
  it('shows the installed release', async () => {
    render(<FirmwareBanner source={new MemoryFirmwareInfo()} />)
    expect(await screen.findByText(/ares-v1.0.0 \(v1.0.0-abc1234\)/)).toBeInTheDocument()
  })

  it('warns when the event expects another release', async () => {
    render(<FirmwareBanner source={new MemoryFirmwareInfo()} eventTag="ares-v2.0.0" />)
    const el = await screen.findByLabelText('installed firmware')
    expect(el).toHaveTextContent(/expects ares-v2.0.0/)
    expect(el.className).toContain('warn')
  })

  it('rereads on request', async () => {
    const src = new MemoryFirmwareInfo({ release: null, versions: [], envs: [] })
    render(<FirmwareBanner source={src} />)
    expect(await screen.findByText(/No firmware is loaded/)).toBeInTheDocument()
    src.info = { release: 'ares-v1.0.0', versions: ['v1.0.0-x'], envs: [] }
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(screen.getByText(/Firmware installed: ares-v1.0.0/)).toBeInTheDocument())
  })

  it('reports an unreadable firmware directory', async () => {
    const src = { installed: () => Promise.reject(new Error('offline')) }
    render(<FirmwareBanner source={src} />)
    expect(await screen.findByText(/could not read the firmware directory: offline/)).toBeInTheDocument()
    const bad = { installed: () => Promise.reject('boom') }
    render(<FirmwareBanner source={bad} />)
    expect(await screen.findByText(/boom/)).toBeInTheDocument()
  })
})
