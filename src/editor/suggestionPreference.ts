let enabled = true
const key = 'xiumi:auto-input-suggestions'
export function readSuggestionPreference(): boolean {
  try { enabled = localStorage.getItem(key) !== 'off' } catch { /* Keep the page preference when storage is unavailable. */ }
  return enabled
}
export function saveSuggestionPreference(value: boolean): void {
  enabled = value
  try { localStorage.setItem(key, value ? 'on' : 'off') } catch { /* Still respected across panel remounts. */ }
}
