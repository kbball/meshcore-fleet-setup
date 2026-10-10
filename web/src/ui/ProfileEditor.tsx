import { useMemo, useState } from 'react'
import { downloadText } from '../adapters/browser/download'
import { parseProfile, validateProfile, type Profile } from '../domain/profile'
import {
  FIRMWARE_VARIANTS,
  emptyForm,
  fromProfile,
  profileFileName,
  profileJson,
  redactProfile,
  toProfile,
  type ProfileForm,
} from '../domain/profileForm'
import { TRACKER_FIELDS } from './trackerFields'

/** The profile keyword for the standard public channel key. */
const PUBLIC = 'public'

export function randomHex(bytes: number, c: Crypto = globalThis.crypto): string {
  return Array.from(c.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('')
}

type Props = {
  /** Profile currently loaded for the batch; the editor starts from it. */
  initial: Profile | null
  /** Use the built profile for the batch. */
  onUse: (p: Profile) => void
  random?: (bytes: number) => string
}

export function ProfileEditor({ initial, onUse, random = randomHex }: Props) {
  const [form, setForm] = useState<ProfileForm>(() =>
    initial ? fromProfile(initial) : emptyForm('companion'),
  )
  const [showSecrets, setShowSecrets] = useState(false)
  const [loadError, setLoadError] = useState('')

  const profile = useMemo(() => toProfile(form), [form])
  const problems = useMemo(() => validateProfile(profile), [profile])
  const set = (patch: Partial<ProfileForm>) => setForm((f) => ({ ...f, ...patch }))
  const isCompanion = form.kind === 'companion'
  const variants = FIRMWARE_VARIANTS.filter((v) => v.kind === form.kind)

  function switchKind(kind: ProfileForm['kind']) {
    if (kind !== form.kind) setForm(emptyForm(kind))
  }

  async function load(file: File | undefined) {
    if (!file) return
    try {
      setForm(fromProfile(parseProfile(await file.text())))
      setLoadError('')
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }

  return (
    <fieldset className="panel">
      <legend>Profile builder</legend>
      <p className="muted">
        Build the profile file for a batch. Nothing is saved or uploaded: download the file and keep it
        somewhere private, it holds your channel keys.
      </p>
      <div className="row end">
        <label>
          Edit an existing file{' '}
          <input type="file" accept="application/json,.json" onChange={(e) => load(e.target.files?.[0])} />
        </label>
        <button
          onClick={() => {
            setForm(emptyForm(form.kind))
            setLoadError('')
          }}
        >
          Start over
        </button>
      </div>
      {loadError && (
        <p role="alert" className="notice bad">
          {loadError}
        </p>
      )}

      <div className="row">
        <label>
          Node type
          <select value={form.kind} onChange={(e) => switchKind(e.target.value as ProfileForm['kind'])}>
            <option value="companion">Companion (people)</option>
            <option value="tracker">Sweep tracker</option>
          </select>
        </label>
        <label>
          Firmware
          <select value={form.firmware_variant} onChange={(e) => set({ firmware_variant: e.target.value })}>
            {variants.map((v) => (
              <option key={v.env} value={v.env}>
                {v.label}
              </option>
            ))}
            {!variants.some((v) => v.env === form.firmware_variant) && (
              <option value={form.firmware_variant}>{form.firmware_variant}</option>
            )}
          </select>
        </label>
        <label>
          {isCompanion ? 'Advert name template' : 'Node name template'}
          <input
            value={form.name_template}
            onChange={(e) => set({ name_template: e.target.value })}
            placeholder={isCompanion ? 'AS3-{n}' : 'Sweep{n}'}
          />
          <span className="hint">
            {'{n}'} becomes the node counter. Leave empty to keep each node&apos;s own name.
          </span>
        </label>
      </div>

      {isCompanion ? (
        <CompanionFields form={form} set={set} random={random} />
      ) : (
        <TrackerFields form={form} set={set} random={random} />
      )}

      <h3>Result</h3>
      {problems.length > 0 ? (
        <div role="alert" className="notice bad">
          <strong>Fix before using:</strong>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="notice ok">Profile is valid.</p>
      )}
      <label className="check">
        <input type="checkbox" checked={showSecrets} onChange={(e) => setShowSecrets(e.target.checked)} />{' '}
        Show keys in the preview
      </label>
      <pre aria-label="profile json" className="log">
        {profileJson(showSecrets ? profile : redactProfile(profile))}
      </pre>
      <div className="row">
        <button className="primary" disabled={problems.length > 0} onClick={() => onUse(profile)}>
          Use for the batch
        </button>
        <button
          disabled={problems.length > 0}
          onClick={() => downloadText(profileFileName(profile), profileJson(profile), 'application/json')}
        >
          Download profile file
        </button>
      </div>
    </fieldset>
  )
}

type SectionProps = {
  form: ProfileForm
  set: (p: Partial<ProfileForm>) => void
  random: (bytes: number) => string
}

function CompanionFields({ form, set, random }: SectionProps) {
  const setChannel = (i: number, patch: Partial<ProfileForm['channels'][number]>) =>
    set({ channels: form.channels.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const setRadio = (patch: Partial<ProfileForm['radio']>) => set({ radio: { ...form.radio, ...patch } })
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          checked={form.wipe_first}
          onChange={(e) => set({ wipe_first: e.target.checked })}
        />{' '}
        Wipe each node first (factory reset)
      </label>
      {!form.wipe_first && (
        <p className="muted">
          Without a wipe only the fields below are written; the rest stays as the node had it.
        </p>
      )}

      <h3>Radio</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={form.radio.enabled}
          onChange={(e) => setRadio({ enabled: e.target.checked })}
        />{' '}
        Set radio parameters
      </label>
      {form.radio.enabled && (
        <div className="row">
          <Num label="Frequency (MHz)" value={form.radio.freq} onChange={(v) => setRadio({ freq: v })} />
          <Num label="Bandwidth (kHz)" value={form.radio.bw} onChange={(v) => setRadio({ bw: v })} />
          <Num label="Spreading factor" value={form.radio.sf} onChange={(v) => setRadio({ sf: v })} />
          <Num label="Coding rate" value={form.radio.cr} onChange={(v) => setRadio({ cr: v })} />
          <Num
            label="TX power (dBm)"
            value={form.radio.tx_power}
            onChange={(v) => setRadio({ tx_power: v })}
          />
        </div>
      )}

      <h3>Channels</h3>
      <p className="muted">
        In order: the first is slot 0. Tick Public for the standard public channel; it uses the built-in key.
      </p>
      {form.channels.map((c, i) => (
        <div className="row end" key={i}>
          <label>
            Name{' '}
            <input
              aria-label={`Channel ${i + 1} name`}
              value={c.name}
              onChange={(e) => setChannel(i, { name: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              aria-label={`Channel ${i + 1} is public`}
              checked={c.secret === PUBLIC}
              onChange={(e) => setChannel(i, { secret: e.target.checked ? PUBLIC : '' })}
            />{' '}
            Public
          </label>
          <label>
            Key (32 hex characters or base64)
            <input
              aria-label={`Channel ${i + 1} key`}
              value={c.secret === PUBLIC ? '' : c.secret}
              placeholder={c.secret === PUBLIC ? 'Built-in public channel key' : ''}
              disabled={c.secret === PUBLIC}
              onChange={(e) => setChannel(i, { secret: e.target.value })}
            />
          </label>
          <button disabled={c.secret === PUBLIC} onClick={() => setChannel(i, { secret: random(16) })}>
            Generate key
          </button>
          <button
            className="ghost"
            onClick={() => set({ channels: form.channels.filter((_, j) => j !== i) })}
            aria-label={`Remove channel ${i + 1}`}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="row">
        <button onClick={() => set({ channels: [...form.channels, { name: '', secret: '' }] })}>
          Add channel
        </button>
        {!form.channels.some((c) => c.secret === PUBLIC) && (
          <button
            className="ghost"
            onClick={() => set({ channels: [{ name: 'Public', secret: 'public' }, ...form.channels] })}
          >
            Add the public channel
          </button>
        )}
      </div>

      <h3>Location and scope</h3>
      <div className="row">
        <Num label="Latitude" value={form.lat} onChange={(v) => set({ lat: v })} />
        <Num label="Longitude" value={form.lon} onChange={(v) => set({ lon: v })} />
      </div>
      <div className="row end">
        <label>
          Flood scope name{' '}
          <input value={form.flood_name} onChange={(e) => set({ flood_name: e.target.value })} />
        </label>
        <label>
          Flood scope key (32 hex characters){' '}
          <input value={form.flood_key} onChange={(e) => set({ flood_key: e.target.value })} />
        </label>
        <button onClick={() => set({ flood_key: random(16) })}>Generate key</button>
      </div>

      <h3>Identity and access</h3>
      <div className="row end">
        <label>
          Identity
          <select
            value={form.identity}
            onChange={(e) => set({ identity: e.target.value as ProfileForm['identity'] })}
          >
            <option value="generate">Generate per node (new after a wipe)</option>
            <option value="import">Import one private key onto every node</option>
            <option value="none">Leave as is</option>
          </select>
        </label>
        {form.identity === 'import' && (
          <>
            <label>
              Private key (128 hex characters){' '}
              <input value={form.private_key} onChange={(e) => set({ private_key: e.target.value })} />
            </label>
            <button onClick={() => set({ private_key: random(64) })}>Generate key</button>
          </>
        )}
        <Num
          label="BLE PIN (6 digits, 0 = none)"
          value={form.ble_pin}
          onChange={(v) => set({ ble_pin: v })}
        />
      </div>
      {form.identity === 'import' && (
        <p className="notice warn">Every node will share this identity. Only do this if you mean it.</p>
      )}

      <h3>GPS</h3>
      <div className="row end">
        <label>
          GPS
          <select value={form.gps} onChange={(e) => set({ gps: e.target.value as ProfileForm['gps'] })}>
            <option value="leave">Leave as is</option>
            <option value="on">Enable</option>
            <option value="off">Disable</option>
          </select>
        </label>
        {form.gps === 'on' && (
          <Num
            label="Position update interval (s, 0 = none)"
            value={form.gps_interval}
            onChange={(v) => set({ gps_interval: v })}
          />
        )}
      </div>
      <p className="muted">
        Only boards with a GPS have this (the T-1000-E does; the XIAO and RAK4631 companion builds do not).
        Enabling it on a node without one fails the run. The firmware default is off, so a wipe turns it off
        again.
      </p>

      <label className="check">
        <input
          type="checkbox"
          checked={form.autoadd.enabled}
          onChange={(e) => set({ autoadd: { ...form.autoadd, enabled: e.target.checked } })}
        />{' '}
        Set auto-add contacts
      </label>
      {form.autoadd.enabled && (
        <div className="row">
          <Num
            label="Auto-add config (bit flags)"
            value={form.autoadd.config}
            onChange={(v) => set({ autoadd: { ...form.autoadd, config: v } })}
          />
          <Num
            label="Max hops (optional)"
            value={form.autoadd.max_hops}
            onChange={(v) => set({ autoadd: { ...form.autoadd, max_hops: v } })}
          />
        </div>
      )}
    </>
  )
}

function TrackerFields({ form, set, random }: SectionProps) {
  const setT = (key: string, value: string) => set({ tracker: { ...form.tracker, [key]: value } })
  return (
    <>
      <h3>Reporting channel</h3>
      <div className="row end">
        <label>
          Channel name{' '}
          <input value={form.tracker.channel_name} onChange={(e) => setT('channel_name', e.target.value)} />
        </label>
        <label>
          Channel key (base64, or 32/64 hex characters){' '}
          <input value={form.tracker.channel_psk} onChange={(e) => setT('channel_psk', e.target.value)} />
        </label>
        <button onClick={() => setT('channel_psk', random(16))}>Generate key</button>
      </div>
      <h3>Timing and radio</h3>
      <p className="muted">Empty fields are not written, so the node keeps its current value.</p>
      <div className="row">
        {TRACKER_FIELDS.map((f) =>
          f.options ? (
            <label key={f.key}>
              {f.label}
              <select value={form.tracker[f.key]} onChange={(e) => setT(f.key, e.target.value)}>
                <option value="">(leave as is)</option>
                {f.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          ) : (
            <Num key={f.key} label={f.label} value={form.tracker[f.key]} onChange={(v) => setT(f.key, v)} />
          ),
        )}
      </div>
    </>
  )
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label>
      {label}
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}
