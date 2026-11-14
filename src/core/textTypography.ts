/** Document typography, deliberately separate from application UI fonts. */
export const TEXT_FONTS = [
  { label: '无衬线 / 黑体', value: 'Noto Sans SC Variable, Noto Sans SC, Microsoft YaHei, sans-serif' },
  { label: '宋体', value: 'Noto Serif SC Variable, Noto Serif SC, SimSun, serif' },
  { label: '楷体', value: 'KaiTi, STKaiti, serif' },
  { label: '仿宋', value: 'FangSong, STFangsong, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: 'Times New Roman, serif' },
  { label: '等宽', value: 'Consolas, Courier New, monospace' },
] as const
export const TEXT_SIZES = [12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48]
export function safeTextFont(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 180 && /^[\p{L}\p{N}\s,\-'"]+$/u.test(value) ? value : undefined
}
export function safeTextSize(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?px$/.test(value)) return undefined
  const size = Number.parseFloat(value)
  return size >= 8 && size <= 96 ? `${size}px` : undefined
}
