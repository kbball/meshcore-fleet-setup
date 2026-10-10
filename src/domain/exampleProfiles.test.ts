// @vitest-environment node
import { readFileSync } from 'node:fs'
import { parseProfile } from './profile'
it.each(['companion', 'tracker'])('%s example profile is valid', (k) => {
  expect(parseProfile(readFileSync(`profiles/${k}.example.json`, 'utf8')).kind).toBe(k)
})
