import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'
const KEY = 'fleet-theme'
const ORDER: ThemeChoice[] = ['system', 'light', 'dark']

export const nextTheme = (t: ThemeChoice): ThemeChoice => ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]

export function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** 'system' leaves the attribute off so the OS preference (prefers-color-scheme) decides. */
export function applyTheme(t: ThemeChoice) {
  const el = document.documentElement
  if (t === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', t)
  try {
    if (t === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, t)
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

export function useTheme(): [ThemeChoice, () => void] {
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme)
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  const cycle = useCallback(() => setTheme((t) => nextTheme(t)), [])
  return [theme, cycle]
}
