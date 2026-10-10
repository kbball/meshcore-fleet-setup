import type { TrackerConfig } from '../domain/tracker'

export type TrackerField = { key: keyof TrackerConfig; label: string; options?: string[] }

/** Tracker settings other than the channel, in the order they appear in the builder. */
export const TRACKER_FIELDS: TrackerField[] = [
  { key: 'interval_sec', label: 'Report interval while moving (s, min 300)' },
  { key: 'idle_interval_sec', label: 'Heartbeat interval while idle (s)' },
  { key: 'idle_holdoff_sec', label: 'Stillness before idle (s, 60-3600)' },
  { key: 'fix_timeout_sec', label: 'GPS fix timeout (s, 10-300)' },
  { key: 'move_distance_m', label: 'Move distance override (m, 5-500)' },
  { key: 'motion_threshold', label: 'Motion threshold (1-255)' },
  { key: 'nofix_mode', label: 'No-fix messages', options: ['notify', 'silent'] },
  { key: 'nofix_notify_interval_sec', label: 'No-fix notify interval (s)' },
  { key: 'freq', label: 'Frequency (MHz)' },
  { key: 'bw', label: 'Bandwidth (kHz)' },
  { key: 'sf', label: 'Spreading factor' },
  { key: 'cr', label: 'Coding rate' },
  { key: 'tx_power', label: 'TX power (dBm)' },
]
