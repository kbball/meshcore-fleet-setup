import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { parseProfile, type Profile } from '../domain/profile'
import { ProfileEditor, randomHex } from './ProfileEditor'

const fixedRandom = (n: number) => 'ab'.repeat(n)

function setup(initial: Profile | null = null) {
  const onUse = vi.fn()
  render(<ProfileEditor initial={initial} onUse={onUse} random={fixedRandom} />)
  return { onUse }
}
const json = () => JSON.parse(screen.getByLabelText('profile json').textContent ?? '{}')

describe('ProfileEditor', () => {
  it('starts with a valid default companion profile', () => {
    setup()
    expect(screen.getByText('Profile is valid.')).toBeInTheDocument()
    expect(json()).toMatchObject({ kind: 'companion', wipe_first: true, radio: { freq: 910.525 } })
  })

  it('builds a profile: channels, keys, location, pin, and hides secrets until asked', async () => {
    const { onUse } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Add channel' }))
    await userEvent.type(screen.getByLabelText('Channel 2 name'), 'aid3')
    await userEvent.click(
      within(screen.getByLabelText('Channel 2 name').closest('.row')!).getByRole('button', {
        name: 'Generate key',
      }),
    )
    expect(screen.getByLabelText('Channel 2 key')).toHaveValue('ab'.repeat(16))
    expect(screen.getByLabelText('profile json').textContent).not.toContain('abababab')
    await userEvent.click(screen.getByLabelText(/show keys/i))
    expect(screen.getByLabelText('profile json').textContent).toContain('ab'.repeat(16))

    fireEvent.change(screen.getByLabelText(/Advert name template/), { target: { value: 'AS3-{n}' } })
    await userEvent.type(screen.getByLabelText('Latitude'), '33.8')
    await userEvent.type(screen.getByLabelText('Longitude'), '-84.1')
    await userEvent.type(screen.getByLabelText(/BLE PIN/), '123456')
    expect(screen.getByText('Profile is valid.')).toBeInTheDocument()
    expect(json()).toMatchObject({
      channels: [{ name: 'Public', secret: 'public' }, { name: 'aid3' }],
      advert: { name_template: 'AS3-{n}', lat: 33.8, lon: -84.1 },
      ble_pin: 123456,
    })

    await userEvent.click(screen.getByRole('button', { name: 'Use for the batch' }))
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ kind: 'companion', ble_pin: 123456 }))
  })

  it('the public checkbox disables the key field and sets the built-in key', async () => {
    setup()
    const key = screen.getByLabelText('Channel 1 key')
    expect(screen.getByLabelText('Channel 1 is public')).toBeChecked() // the default first channel
    expect(key).toBeDisabled()
    expect(key).toHaveAttribute('placeholder', 'Built-in public channel key')
    expect(json().channels).toEqual([{ name: 'Public', secret: 'public' }])
    const generate = within(key.closest('.row')!).getByRole('button', { name: 'Generate key' })
    expect(generate).toBeDisabled()

    await userEvent.click(screen.getByLabelText('Channel 1 is public')) // untick: key is needed again
    expect(key).toBeEnabled()
    expect(key).toHaveValue('')
    expect(screen.getByRole('alert')).toHaveTextContent('channels[0].secret')
    await userEvent.type(key, '00112233445566778899aabbccddeeff')
    expect(screen.getByText('Profile is valid.')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Channel 1 is public')) // tick again: typed key is replaced
    expect(key).toBeDisabled()
    expect(json().channels[0].secret).toBe('public')
  })

  it('a loaded public channel shows ticked', () => {
    setup(
      parseProfile(
        JSON.stringify({
          kind: 'companion',
          firmware_variant: 'x',
          wipe_first: false,
          channels: [
            { name: 'Public', secret: 'public' },
            { name: 'aid', secret: '00112233445566778899aabbccddeeff' },
          ],
        }),
      ),
    )
    expect(screen.getByLabelText('Channel 1 is public')).toBeChecked()
    expect(screen.getByLabelText('Channel 2 is public')).not.toBeChecked()
    expect(screen.getByLabelText('Channel 2 key')).toBeEnabled()
  })

  it('shows what is wrong and blocks use and download', async () => {
    const { onUse } = setup()
    fireEvent.change(screen.getByLabelText('Spreading factor'), { target: { value: '99' } })
    fireEvent.change(screen.getByLabelText(/BLE PIN/), { target: { value: '12' } })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('radio.sf must be an integer between 5 and 12')
    expect(alert).toHaveTextContent('ble_pin must be 0 or a 6 digit number')
    expect(screen.getByRole('button', { name: 'Use for the batch' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download profile file' })).toBeDisabled()
    expect(onUse).not.toHaveBeenCalled()
  })

  it('toggles sections: wipe note, radio, identity import, flood scope, auto-add, remove channel', async () => {
    setup()
    await userEvent.click(screen.getByLabelText(/wipe each node first/i))
    expect(screen.getByText(/without a wipe only the fields below/i)).toBeInTheDocument()
    expect(json().wipe_first).toBe(false)

    await userEvent.click(screen.getByLabelText(/set radio parameters/i))
    expect(json().radio).toBeUndefined()

    await userEvent.selectOptions(screen.getByLabelText('Identity'), 'import')
    expect(screen.getByText(/share this identity/i)).toBeInTheDocument()
    await userEvent.click(
      within(screen.getByLabelText(/Private key/).closest('.row')!).getByRole('button', {
        name: 'Generate key',
      }),
    )
    expect(json().identity).toEqual({ mode: 'import', private_key: '••••••••' })
    await userEvent.selectOptions(screen.getByLabelText('Identity'), 'none')
    expect(json().identity).toBeUndefined()

    await userEvent.type(screen.getByLabelText('Flood scope name'), 'ga')
    await userEvent.click(
      within(screen.getByLabelText('Flood scope name').closest('.row')!).getByRole('button', {
        name: 'Generate key',
      }),
    )
    expect(json().advert.flood_scope.name).toBe('ga')

    await userEvent.click(screen.getByLabelText(/set auto-add/i))
    fireEvent.change(screen.getByLabelText(/Auto-add config/), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/Max hops/), { target: { value: '3' } })
    expect(json().autoadd).toEqual({ config: 2, max_hops: 3 })

    await userEvent.click(screen.getByRole('button', { name: 'Remove channel 1' }))
    expect(json().channels).toBeUndefined()
    await userEvent.click(screen.getByRole('button', { name: 'Add the public channel' }))
    expect(json().channels).toEqual([{ name: 'Public', secret: 'public' }])
  })

  it('sets GPS on or off, with an interval only when enabling', async () => {
    setup()
    expect(json().gps).toBeUndefined()
    await userEvent.selectOptions(screen.getByLabelText('GPS'), 'on')
    fireEvent.change(screen.getByLabelText(/Position update interval/), { target: { value: '900' } })
    expect(json().gps).toEqual({ enabled: true, interval_sec: 900 })
    fireEvent.change(screen.getByLabelText(/Position update interval/), { target: { value: '999999' } })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'gps.interval_sec must be an integer between 0 and 86400',
    )
    await userEvent.selectOptions(screen.getByLabelText('GPS'), 'off')
    expect(json().gps).toEqual({ enabled: false })
    expect(screen.queryByLabelText(/Position update interval/)).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('GPS'), 'leave')
    expect(json().gps).toBeUndefined()
  })

  it('switches to a tracker and builds its config', async () => {
    setup()
    await userEvent.selectOptions(screen.getByLabelText('Node type'), 'tracker')
    expect(screen.getByLabelText('Firmware')).toHaveValue('t1000e_gps_tracker')
    expect(json()).toMatchObject({ kind: 'tracker', name_template: 'Sweep{n}' })
    await userEvent.type(screen.getByLabelText('Channel name'), 'race')
    await userEvent.click(screen.getByRole('button', { name: 'Generate key' }))
    fireEvent.change(screen.getByLabelText(/Report interval/), { target: { value: '100' } })
    expect(screen.getByRole('alert')).toHaveTextContent('config: interval_sec must be between 300')
    fireEvent.change(screen.getByLabelText(/Report interval/), { target: { value: '600' } })
    await userEvent.selectOptions(screen.getByLabelText('No-fix messages'), 'silent')
    expect(screen.getByText('Profile is valid.')).toBeInTheDocument()
    expect(json().config).toMatchObject({
      channel_name: 'race',
      channel_psk: '••••••••',
      interval_sec: 600,
      nofix_mode: 'silent',
    })
    await userEvent.selectOptions(screen.getByLabelText('Node type'), 'tracker') // same kind: keeps the form
    expect(json().config.channel_name).toBe('race')
  })

  it('edits an existing file and reports a bad one', async () => {
    setup()
    const file = (text: string) => new File([text], 'p.json', { type: 'application/json' })
    const good = { kind: 'companion', firmware_variant: 'custom_env', wipe_first: false, ble_pin: 654321 }
    fireEvent.change(screen.getByLabelText(/edit an existing file/i), {
      target: { files: [file(JSON.stringify(good))] },
    })
    expect(await screen.findByDisplayValue('654321')).toBeInTheDocument()
    expect(json()).toMatchObject({ firmware_variant: 'custom_env', wipe_first: false })
    expect(screen.getByRole('option', { name: 'custom_env' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/edit an existing file/i), { target: { files: [file('{nope')] } })
    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(screen.queryByText(/not valid JSON/)).not.toBeInTheDocument()
    expect(json().ble_pin).toBeUndefined()
  })

  it('starts from the profile already loaded, and downloads a file that parses back', async () => {
    const initial = parseProfile(
      JSON.stringify({
        kind: 'tracker',
        firmware_variant: 't1000e_gps_tracker',
        name_template: 'Sweep{n}',
        config: { sf: 7 },
      }),
    )
    setup(initial)
    expect(screen.getByLabelText('Node type')).toHaveValue('tracker')
    URL.createObjectURL = vi.fn(() => 'blob:p')
    URL.revokeObjectURL = vi.fn()
    let name = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download
    })
    await userEvent.click(screen.getByRole('button', { name: 'Download profile file' }))
    expect(name).toBe('tracker-profile.json')
    const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob
    expect(parseProfile(await blob.text())).toEqual(initial)
  })
})

describe('randomHex', () => {
  it('produces 2 hex characters per byte', () => {
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/)
    expect(randomHex(16)).not.toBe(randomHex(16))
  })
})
