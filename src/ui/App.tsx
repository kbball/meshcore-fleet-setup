import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { mailtoUrl } from '../adapters/browser/download'
import { resultsCsv } from '../app/batch'
import type { NodeResult } from '../app/nodeRunner'
import { restoreNode } from '../app/restoreNode'
import { parseProfile, profileHasSecrets, type Profile } from '../domain/profile'
import { buildApp, systemClock, type App as AppServices } from '../wiring'
import { AppHeader } from './AppHeader'

type PromptState = { msg: string; resolve: () => void } | null

export function App({ version, factory = buildApp }: { version: string; factory?: typeof buildApp }) {
  const serial = typeof navigator !== 'undefined' && 'serial' in navigator
  const [prompt, setPrompt] = useState<PromptState>(null)
  const [progress, setProgress] = useState<{ step: string; pct: number } | null>(null)
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  const services = useMemo<AppServices>(
    () =>
      factory(
        (msg) =>
          new Promise<void>((resolve) => setPrompt({ msg, resolve: () => (setPrompt(null), resolve()) })),
        (step, pct) => setProgress({ step, pct }),
      ),
    [factory],
  )
  useEffect(() => services.logger.subscribe(rerender), [services])

  return (
    <main className="page">
      <AppHeader version={version} />
      {!serial && (
        <p role="alert" className="notice warn">
          Web Serial is not available. Use Chrome or Edge on desktop.
        </p>
      )}
      <BatchPanel services={services} progress={progress} onDone={rerender} />
      <RestorePanel services={services} />
      <fieldset className="panel">
        <legend>Log</legend>
        <pre aria-label="log" className="log">
          {services.logger.entries
            .map(
              (e) =>
                `${e.time.slice(11, 19)} ${e.level} ${e.msg} ${e.fields ? JSON.stringify(e.fields) : ''}`,
            )
            .join('\n')}
        </pre>
      </fieldset>
      {prompt && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-label="Action needed">
            <p>{prompt.msg}</p>
            <div className="actions">
              <button className="primary" onClick={prompt.resolve}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function BatchPanel({
  services,
  progress,
  onDone,
}: {
  services: AppServices
  progress: { step: string; pct: number } | null
  onDone: () => void
}) {
  const { batch } = services
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState(true)
  const [backup, setBackup] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<NodeResult | null>(null)
  const file = useRef<HTMLInputElement>(null)

  async function loadProfile(f: File | undefined) {
    if (!f) return
    try {
      setProfile(parseProfile(await f.text())) // held in memory only; never persisted
      setError('')
    } catch (e) {
      setProfile(null)
      setError((e as Error).message)
    }
  }

  async function run() {
    if (!profile) return
    setBusy(true)
    setError('')
    try {
      const res = await batch.runNext(profile, {
        flash,
        backup: backup && profile.kind === 'companion' ? { passphrase } : undefined,
      })
      setLast(res)
      if (res.backupFile && email) window.open(mailtoUrl(email, res.name, res.backupFile))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      await services.connector.release()
      setBusy(false)
      onDone()
    }
  }

  const next = (() => {
    try {
      return profile ? batch.nextName(profile) : undefined
    } catch (e) {
      return `(${(e as Error).message})`
    }
  })()
  const canBackup = profile?.kind === 'companion'
  const blocked = busy || !profile || (backup && canBackup && passphrase === '')

  return (
    <fieldset className="panel">
      <legend>Batch</legend>
      <label>
        Profile file{' '}
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          onChange={(e) => loadProfile(e.target.files?.[0])}
        />
      </label>
      {error && (
        <p role="alert" className="notice bad">
          {error}
        </p>
      )}
      {profile && (
        <>
          <p className="profile-summary">
            <span className="chip">{profile.kind}</span>
            <span>
              firmware <code>{profile.firmware_variant}</code>
            </span>
            {profile.kind === 'companion' &&
              (profile.wipe_first ? (
                <span className="chip warn">wipes each node first</span>
              ) : (
                <span className="chip">no wipe</span>
              ))}
            {profileHasSecrets(profile) && <span className="chip">contains keys, kept in memory only</span>}
          </p>
          <label className="check">
            <input type="checkbox" checked={flash} onChange={(e) => setFlash(e.target.checked)} /> Flash
            firmware
          </label>
          {canBackup && (
            <>
              <label className="check">
                <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} /> Back
                up this node first
              </label>
              {backup && (
                <div className="row">
                  <label>
                    Backup passphrase{' '}
                    <input type="text" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                  </label>
                  <label>
                    Owner email (optional){' '}
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                </div>
              )}
            </>
          )}
          <div className="next-node">
            <span>
              Next node: <strong>{next ?? '(keeps its own name)'}</strong>
            </span>
            <label>
              Counter
              <input
                type="number"
                min={1}
                value={batch.counter}
                onChange={(e) => (batch.setCounter(Number(e.target.value)), onDone())}
              />
            </label>
          </div>
          <div className="row">
            <button className="primary" disabled={blocked} onClick={run}>
              {busy ? 'Working…' : 'Run next node'}
            </button>
            {busy && progress && <progress max={100} value={progress.pct} aria-label={progress.step} />}
          </div>
        </>
      )}
      {last && (
        <div role="status" className={`notice ${last.ok ? 'ok' : 'bad'}`}>
          {last.name}: {last.ok ? 'done' : 'FAILED'}
          <div className="steps">
            {last.steps.map((s) => (
              <span
                key={s.step}
                className={`chip ${s.status === 'ok' ? 'ok' : s.status === 'failed' ? 'bad' : ''}`}
              >
                {s.step} {s.status}
              </span>
            ))}
          </div>
        </div>
      )}
      <Results results={batch.results} onClear={() => (batch.clear(), onDone())} />
    </fieldset>
  )
}

function Results({ results, onClear }: { results: readonly NodeResult[]; onClear: () => void }) {
  if (results.length === 0) return null
  const csv = () => {
    const url = URL.createObjectURL(new Blob([resultsCsv(results)], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'fleet-setup-results.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <>
      <h3>Results</h3>
      <div className="table-scroll">
        <table className="results">
          <thead>
            <tr>
              <th>Time</th>
              <th>Name</th>
              <th>Kind</th>
              <th>Result</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>{r.startedAt.slice(11, 19)}</td>
                <td>{r.name}</td>
                <td>{r.kind}</td>
                <td>
                  <span className={`chip ${r.ok ? 'ok' : 'bad'}`}>{r.ok ? 'ok' : 'FAILED'}</span>
                </td>
                <td>{r.steps.find((s) => s.status === 'failed')?.detail ?? r.backupFile ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button onClick={csv}>Download CSV</button>
        <button className="ghost" onClick={onClear}>
          Clear log and reset counter
        </button>
      </div>
    </>
  )
}

function RestorePanel({ services }: { services: AppServices }) {
  const [text, setText] = useState('')
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function restore() {
    setBusy(true)
    setMsg('')
    try {
      const r = await restoreNode(
        { connector: services.connector, cipher: services.cipher, clock: systemClock, log: services.logger },
        text,
        pass,
      )
      setMsg(
        r.problems.length
          ? `Restored ${r.name} with problems:\n${r.problems.join('\n')}`
          : `Restored ${r.name}.`,
      )
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      await services.connector.release()
      setBusy(false)
    }
  }

  return (
    <fieldset className="panel">
      <legend>Restore a backup</legend>
      <label>
        Backup file{' '}
        <input
          type="file"
          accept="application/json,.json"
          onChange={async (e) => setText(e.target.files?.[0] ? await e.target.files[0].text() : '')}
        />
      </label>
      <label>
        Passphrase <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
      </label>
      <button disabled={busy || !text || !pass} onClick={restore}>
        Restore to connected node
      </button>
      {msg && (
        <p
          role="status"
          className={`notice ${msg.startsWith('Restored') && !msg.includes('problems') ? 'ok' : 'bad'}`}
        >
          {msg}
        </p>
      )}
    </fieldset>
  )
}
