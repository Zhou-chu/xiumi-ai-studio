export type ColorModePreference = 'auto' | 'light' | 'dark' | 'upstream'
export type ResolvedColorMode = Exclude<ColorModePreference, 'auto'>

export const COLOR_MODE_KEY = 'xiumi-color-mode'
const UPSTREAM_UI_THEME_KEY = 'xiumi-ui-theme'

function isColorMode(value: unknown): value is ColorModePreference {
  return value === 'light' || value === 'dark' || value === 'upstream' || value === 'auto'
}

export function parseColorMode(value: unknown): ColorModePreference {
  return isColorMode(value) ? value : 'auto'
}

/** Use the device's current local wall clock, including its current timezone/DST. */
export function resolveColorMode(preference: ColorModePreference, now = new Date()): ResolvedColorMode {
  if (preference !== 'auto') return preference
  const hour = now.getHours()
  return hour >= 7 && hour < 19 ? 'light' : 'dark'
}

export function readColorMode(): ColorModePreference {
  try {
    const current = window.localStorage.getItem(COLOR_MODE_KEY)
    if (isColorMode(current)) return current
    // Read the existing upstream choice without rewriting either key. Future
    // explicit choices use only COLOR_MODE_KEY, including a user-selected auto.
    switch (window.localStorage.getItem(UPSTREAM_UI_THEME_KEY)) {
      case 'upstream': return 'upstream'
      case 'mono-light': return 'light'
      case 'mono-dark': return 'dark'
      case 'mono-auto':
      default: return 'auto'
    }
  } catch {
    return 'auto'
  }
}

export function saveColorMode(preference: ColorModePreference): void {
  try {
    window.localStorage.setItem(COLOR_MODE_KEY, preference)
  } catch {
    // Private browsing, disabled storage and a full quota still permit this session's choice.
  }
}
