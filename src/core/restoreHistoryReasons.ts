export const restoreHistoryReasons = [
  'parent-mismatch', 'parent-changed', 'retention-limit', 'occupied', 'target-unavailable', 'dependency-unavailable',
] as const

export type RestoreHistoryReason = typeof restoreHistoryReasons[number]
