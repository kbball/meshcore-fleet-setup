import { nextTheme, useTheme, type ThemeChoice } from './theme'

const LABEL: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' }

function Icon({ theme }: { theme: ThemeChoice }) {
  const p = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (theme === 'light')
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    )
  if (theme === 'dark')
    return (
      <svg {...p}>
        <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z" />
      </svg>
    )
  return (
    <svg {...p}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  )
}

/** Cycles System, Light, Dark. */
export function ThemeToggle({ showLabel = false }: { showLabel?: boolean }) {
  const [theme, cycle] = useTheme()
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={cycle}
      title={`Theme: ${LABEL[theme]}`}
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[nextTheme(theme)]}`}
    >
      <Icon theme={theme} />
      {showLabel && <span>{LABEL[theme]}</span>}
    </button>
  )
}
