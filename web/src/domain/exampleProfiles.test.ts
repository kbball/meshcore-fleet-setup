// @vitest-environment node
import { readFileSync } from 'node:fs'
import { parseEventFile } from './event'
import { parseProfile } from './profile'
it.each(['companion', 'tracker'])('%s example profile is valid', (k) => {
  expect(parseProfile(readFileSync(`../profiles/${k}.example.json`, 'utf8')).kind).toBe(k)
})
it('event example file is valid', () => {
  expect(parseEventFile(readFileSync('../profiles/event.example.json', 'utf8')).stations).toHaveLength(2)
})
