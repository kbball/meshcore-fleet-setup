import { useState } from 'react'
import { downloadText } from '../adapters/browser/download'
import {
  addStation,
  channelTable,
  createEventFile,
  formatGoBoxEnv,
  goBoxSettings,
  netControlChannels,
  netControlProfile,
  parseEventFile,
  removeStation,
  rotateStationSecrets,
  stationBundle,
  stationChannels,
  stationCompanionProfile,
  stationGatewayProfile,
  trackerNames,
  trackerProfile,
  type EventFile,
  type RandomBytes,
} from '../domain/event'
import { profileJson } from '../domain/profileForm'
import type { Profile } from '../domain/profile'

export const randomBytes: RandomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))

type Props = {
  /** The event held in memory (secrets inside): lifted to the app so it survives a tab switch, never persisted. */
  event: EventFile | null
  setEvent: (e: EventFile | null) => void
  /** Hand a derived profile to the batch. */
  onUse: (p: Profile) => void
  random?: RandomBytes
  now?: () => Date
}

type CreateForm = {
  name: string
  tag: string
  freq: string
  bw: string
  sf: string
  cr: string
  tx: string
  stations: string
  trackerTemplate: string
  trackerCount: string
  blePin: string
}

const emptyCreate: CreateForm = {
  name: '',
  tag: 'ares-v1.0.0',
  freq: '910.525',
  bw: '62.5',
  sf: '7',
  cr: '5',
  tx: '20',
  stations: 'AS1 Aid Station 1\nAS2 Aid Station 2',
  trackerTemplate: 'Sweep{n}',
  trackerCount: '4',
  blePin: '',
}

/** One station per line: `ID Name`; without a name the ID is used. */
export function parseStationLines(text: string): { id: string; name: string }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [id, ...rest] = l.split(/\s+/)
      return { id, name: rest.join(' ') || id }
    })
}

const save = (name: string, text: string) => downloadText(name, text, 'application/json')
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'

export function EventPanel({ event, setEvent, onUse, random = randomBytes, now = () => new Date() }: Props) {
  const [error, setError] = useState('')
  const guard = (fn: () => void) => {
    try {
      setError('')
      fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <fieldset className="panel">
      <legend>Event</legend>
      <p className="muted">
        One event file holds every channel secret and produces each device&apos;s profile, so channel indexes
        and keys cannot drift. Nothing is saved or uploaded: download the event file and keep it somewhere
        private. Reloading the page forgets it.
      </p>
      {error && (
        <p role="alert" className="notice bad">
          {error}
        </p>
      )}
      {event ? (
        <EventView event={event} setEvent={setEvent} onUse={onUse} random={random} guard={guard} />
      ) : (
        <CreateEvent setEvent={setEvent} random={random} now={now} guard={guard} />
      )}
    </fieldset>
  )
}

function CreateEvent({
  setEvent,
  random,
  now,
  guard,
}: {
  setEvent: (e: EventFile) => void
  random: RandomBytes
  now: () => Date
  guard: (fn: () => void) => void
}) {
  const [f, setF] = useState<CreateForm>(emptyCreate)
  const set = (patch: Partial<CreateForm>) => setF((x) => ({ ...x, ...patch }))
  const field = (label: string, key: keyof CreateForm, hint?: string) => (
    <label>
      {label}
      <input value={f[key]} onChange={(e) => set({ [key]: e.target.value })} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  )

  const create = () =>
    guard(() => {
      const event = createEventFile(
        {
          name: f.name.trim(),
          firmware_tag: f.tag.trim(),
          radio: {
            freq: Number(f.freq),
            bw: Number(f.bw),
            sf: Number(f.sf),
            cr: Number(f.cr),
            ...(f.tx.trim() ? { tx_power: Number(f.tx) } : {}),
          },
          stationIds: parseStationLines(f.stations),
          trackers: { name_template: f.trackerTemplate.trim(), count: Number(f.trackerCount) },
          created: now().toISOString(),
        },
        random,
      )
      setEvent(f.blePin.trim() ? { ...event, ble_pin: Number(f.blePin) } : event)
    })

  return (
    <>
      <h3>Import an event file</h3>
      <label>
        Event file{' '}
        <input
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) {
              const text = await file.text()
              guard(() => setEvent(parseEventFile(text)))
            }
          }}
        />
      </label>

      <h3>Or create one</h3>
      <div className="row">
        {field('Event name', 'name')}
        {field('Firmware release', 'tag', 'The fork release tag every device is flashed from.')}
      </div>
      <div className="row">
        {field('Frequency (MHz)', 'freq')}
        {field('Bandwidth (kHz)', 'bw')}
        {field('Spreading factor', 'sf')}
        {field('Coding rate', 'cr')}
        {field('TX power (dBm)', 'tx')}
      </div>
      <label>
        Aid stations
        <textarea rows={5} value={f.stations} onChange={(e) => set({ stations: e.target.value })} />
        <span className="hint">One per line: a short ID (letters and digits), then its name.</span>
      </label>
      <div className="row">
        {field('Tracker name template', 'trackerTemplate', '{n} becomes 1, 2, 3…: stable and unique.')}
        {field('Number of trackers', 'trackerCount')}
        {field('BLE PIN (optional)', 'blePin')}
      </div>
      <button className="primary" onClick={create}>
        Generate keys and create
      </button>
    </>
  )
}

function EventView({
  event,
  setEvent,
  onUse,
  random,
  guard,
}: {
  event: EventFile
  setEvent: (e: EventFile | null) => void
  onUse: (p: Profile) => void
  random: RandomBytes
  guard: (fn: () => void) => void
}) {
  const [shown, setShown] = useState<string | null>(null)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const channels = 2 + 2 * event.stations.length

  const use = (build: () => Profile) => guard(() => onUse(build()))
  const download = (name: string, build: () => unknown) => guard(() => save(name, json(build())))

  return (
    <>
      <p>
        <strong>{event.name}</strong> · firmware <code>{event.firmware_tag}</code> · {event.stations.length}{' '}
        stations, {channels} channels
      </p>
      <p className="notice warn">
        The event file holds every secret. Never commit or upload it. A station&apos;s own files hold only its
        channels.
      </p>
      <div className="row">
        <button onClick={() => save(`event-${event.name.replace(/\W+/g, '-')}.json`, json(event))}>
          Download event file
        </button>
        <button onClick={() => setEvent(null)}>Close event</button>
      </div>

      <h3>Stations</h3>
      {event.stations.map((st) => (
        <div key={st.id} className="panel" aria-label={`station ${st.id}`}>
          <p>
            <strong>{st.id}</strong> {st.name}
          </p>
          <pre className="log" aria-label={`channels ${st.id}`}>
            {channelTable(stationChannels(event, st)).join('\n')}
          </pre>
          <label>
            Gateway address
            <input
              aria-label={`gateway address ${st.id}`}
              value={st.gateway_address ?? ''}
              placeholder="reserved on the AREDN node"
              onChange={(e) =>
                setEvent({
                  ...event,
                  stations: event.stations.map((s) => {
                    if (s.id !== st.id) return s
                    const { gateway_address: _drop, ...rest } = s
                    void _drop
                    return e.target.value ? { ...rest, gateway_address: e.target.value } : rest
                  }),
                })
              }
            />
          </label>
          <div className="row">
            <button onClick={() => use(() => stationCompanionProfile(event, st))}>
              Use radio profile for {st.id}
            </button>
            <button onClick={() => use(() => stationGatewayProfile(event, st))}>
              Use gateway profile for {st.id}
            </button>
            <button onClick={() => download(`station-${st.id}.json`, () => stationBundle(event, st))}>
              Download {st.id} bundle
            </button>
            <button onClick={() => setShown(shown === st.id ? null : st.id)}>Go-box settings {st.id}</button>
            <button onClick={() => guard(() => setEvent(rotateStationSecrets(event, st.id, random)))}>
              Rotate keys {st.id}
            </button>
            <button onClick={() => setEvent(removeStation(event, st.id))}>Remove {st.id}</button>
          </div>
          {shown === st.id && (
            <>
              <pre className="log" aria-label={`go-box ${st.id}`}>
                {formatGoBoxEnv(goBoxSettings(st))}
              </pre>
              <p className="notice">{goBoxSettings(st).reminder}</p>
            </>
          )}
        </div>
      ))}
      <div className="row end">
        <label>
          New station ID
          <input value={newId} onChange={(e) => setNewId(e.target.value)} />
        </label>
        <label>
          Name
          <input value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <button
          onClick={() =>
            guard(() => {
              setEvent(addStation(event, newId.trim(), newName.trim() || newId.trim(), random))
              setNewId('')
              setNewName('')
            })
          }
        >
          Add station
        </button>
      </div>

      <h3>Sweep trackers</h3>
      <p>
        Names: {trackerNames(event).slice(0, 4).join(', ')}
        {event.trackers.count > 4 ? ` … ${trackerNames(event)[event.trackers.count - 1]}` : ''}. Flash them in
        order: the name becomes the team name in sweep-tracker.
      </p>
      <div className="row">
        <button onClick={() => use(() => trackerProfile(event))}>Use tracker profile</button>
        <button onClick={() => guard(() => save('tracker-profile.json', profileJson(trackerProfile(event))))}>
          Download tracker profile
        </button>
      </div>

      <h3>Net control</h3>
      <p>
        One device that hears every channel ({netControlChannels(event).length} slots). It holds all
        stations&apos; secrets: keep it with the net control operator.
      </p>
      <div className="row">
        <button onClick={() => use(() => netControlProfile(event))}>Use net-control profile</button>
        <button
          onClick={() => guard(() => save('net-control-profile.json', profileJson(netControlProfile(event))))}
        >
          Download net-control profile
        </button>
      </div>
    </>
  )
}
