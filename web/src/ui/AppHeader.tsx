import { ThemeToggle } from './ThemeToggle'

/** Top bar: brand, version and the theme toggle. */
export function AppHeader({ version }: { version: string }) {
  return (
    <header className="app-header card">
      <span className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12.55a11 11 0 0 1 14 0M8.5 16.05a6 6 0 0 1 7 0M12 20h.01" />
          </svg>
        </span>
        <span className="brand-name">MeshCore Fleet Setup</span>
      </span>
      <span className="muted version">v{version}</span>
      <span className="spacer" />
      <ThemeToggle showLabel />
    </header>
  )
}
