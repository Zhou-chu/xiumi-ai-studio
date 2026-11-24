import { useId, useRef, useState, type KeyboardEvent } from 'react'
import './imported-slot-palette.css'

/** The source colors of this fragment, applied only to this text slot. */
export function ImportedSlotPalette({ colors, onChoose }: { colors: string[]; onChoose: (color: string) => void }) {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const id = useId()
  const close = () => {
    setOpen(false)
    opener.current?.focus()
  }
  const dismiss = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }
  return <div className="imported-slot-palette">
    <button ref={opener} type="button" aria-label="片段配色" aria-expanded={open}
      aria-controls={open ? id : undefined} onKeyDown={dismiss} onClick={() => setOpen(value => !value)}>
      片段配色
    </button>
    {open && <div id={id} role="group" aria-label="片段原有颜色" className="imported-slot-swatches">
      {colors.map(color => <button key={color} type="button" aria-label={color} title={color}
        onKeyDown={dismiss} onClick={() => { onChoose(color); close() }}>
        <span aria-hidden="true" style={{ backgroundColor: color }} />
      </button>)}
    </div>}
  </div>
}
