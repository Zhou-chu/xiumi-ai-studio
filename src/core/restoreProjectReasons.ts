export const restoreProjectReasons = ['occupied', 'theme-conflict', 'asset-conflict'] as const
export type RestoreProjectReason = typeof restoreProjectReasons[number]
