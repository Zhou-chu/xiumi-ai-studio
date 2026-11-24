const MAX_ARCHIVED_RICH_LINK = 2048
const disallowed = /[\s\p{Cc}<>"\\]/u
const scheme = /^[a-z][a-z0-9+.-]*:/i
const editorialScheme = /^(?:https?|ftps?|mailto|tel|callto|sms|cid|xmpp):$/i

/** Keep the editor's established editorial protocols and relative links in exports. */
export function richLinkHref(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || disallowed.test(value)) return undefined
  const protocol = value.match(scheme)?.[0]
  return !protocol || editorialScheme.test(protocol) ? value : undefined
}

/** Untrusted legacy backup opts into a smaller, explicit subset. */
export function archivedRichLinkHref(value: unknown): string | undefined {
  const href = richLinkHref(value)
  if (!href || href.length > MAX_ARCHIVED_RICH_LINK) return undefined
  if (/^mailto:[^@/?#]+@[^@/?#]+(?:\?[^#]*)?$/i.test(href)) return href
  if (!/^https?:\/\/[^/?#]/i.test(href)) return undefined
  try {
    const url = new URL(href)
    return url.hostname && !url.username && !url.password ? href : undefined
  } catch {
    return undefined
  }
}

export function markdownLinkLabel(text: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
  return text.replace(/[&<>\\`*_[\]~\r\n]/g, char => entities[char] ?? '&#' + char.charCodeAt(0) + ';')
}

export function markdownLinkDestination(href: string): string {
  // Angle wrapping keeps ordinary parentheses literal without adding Markdown structure.
  // Protect ampersands so a URL resembling an HTML entity is not interpreted as one.
  const value = href.replaceAll('&', '&amp;')
  return /[()&]/.test(href) ? '<' + value + '>' : value
}
