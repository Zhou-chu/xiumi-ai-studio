/** Small, dependency-free editorial UI symbols. Never used in article output. */
const paths: Record<string, string> = {
  cover: 'M2 2h12v12H2z M2 9l4-4 4 5 2-2 2 2 M4 12h6',
  heading: 'M3 3v10 M13 3v10 M3 8h10',
  paragraph: 'M3 4h10 M3 8h10 M3 12h7',
  card: 'M2 3h12v10H2z M4 6h8 M4 10h5',
  quote: 'M3 8h3v4H2V7l3-3 M11 8h3v4h-4V7l3-3',
  imageText: 'M2 3h5v10H2z M10 4h4 M10 8h4 M10 12h4',
  image: 'M2 2h12v12H2z M2 11l4-5 4 5 2-3 2 3 M11 5h.01',
  gallery: 'M1 3h6v10H1z M9 3h6v10H9z',
  timeline: 'M4 2v12 M2 4h4 M8 4h6 M2 8h4 M8 8h4 M2 12h4 M8 12h6',
  table: 'M2 2h12v12H2z M2 6h12 M2 10h12 M7 2v12',
  profile: 'M5 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M2 14v-1a6 5 0 0 1 12 0v1',
  divider: 'M2 8h4 M10 8h4 M8 7v2',
  ending: 'M3 3h10v10H3z M5 8l2 2 4-4',
  html: 'M5 4L1 8l4 4 M11 4l4 4-4 4 M9 2L7 14',
  box: 'M2 2h12v12H2z M4 5h8 M4 8h8 M4 11h5',
  carousel: 'M4 3h8v10H4z M1 6v4 M15 6v4 M6 6l3 2-3 2z',
  frame: 'M1 1h14v14H1z M4 4h8v8H4z',
  photos: 'M2 2h12v12H2z M8 2v12 M2 8h12',
  photos2: 'M2 2h12v12H2z M8 2v12',
  photos3: 'M2 2h12v12H2z M8 2v12 M8 8h6',
  photos4: 'M2 2h12v12H2z M8 2v12 M2 8h12',
}

export function UiIcon({ name }: { name: string }) {
  return <svg className="ui-linear-icon" width="16" height="16" viewBox="0 0 16 16"
    fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false"><path d={paths[name] ?? paths.card} /></svg>
}
