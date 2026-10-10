import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeToggle } from './ThemeToggle'
import { applyTheme, nextTheme, storedTheme } from './theme'

afterEach(() => {
  applyTheme('system')
})

describe('theme', () => {
  it('cycles system, light, dark', () => {
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })

  it('applies and remembers an explicit choice, and clears it for system', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(storedTheme()).toBe('dark')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(storedTheme()).toBe('system')
  })

  it('falls back to system when storage is unavailable', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(storedTheme()).toBe('system')
    expect(() => applyTheme('light')).not.toThrow()
    get.mockRestore()
    set.mockRestore()
  })

  it('the toggle cycles through the three choices with labels', () => {
    render(<ThemeToggle showLabel />)
    const btn = () => screen.getByRole('button')
    expect(btn()).toHaveAccessibleName('Theme: System. Switch to Light')
    fireEvent.click(btn())
    expect(btn()).toHaveAccessibleName('Theme: Light. Switch to Dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    fireEvent.click(btn())
    expect(btn()).toHaveAccessibleName('Theme: Dark. Switch to System')
    fireEvent.click(btn())
    expect(screen.getByText('System')).toBeInTheDocument()
  })
})
