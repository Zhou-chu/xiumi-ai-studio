import { expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { exporterSmoke } from './helpers'

it('exports literal timeline values without turning them into markup or additional items', () => {
  const output = exporterSmoke([createBlock('timeline', { items: [{ time: '09:00', title: 'Start <TBA> [draft]', desc: 'Line A\n- Line B' }] })])
  expect(output).toBe('- **09:00** Start &lt;TBA&gt; \\[draft\\]：Line A<br>- Line B\n')
})

it('preserves caption, escaped data and uneven-width rows in the GFM table', () => {
  const output = exporterSmoke([createBlock('table', { headers: ['Name'], rows: [['A|B', '<em>Literal</em>'], ['C']], caption: 'Results *draft*' })])
  expect(output).toBe('| Name |  |\n| --- | --- |\n| A\\|B | &lt;em&gt;Literal&lt;/em&gt; |\n| C |  |\n\n*Results \\*draft\\**\n')
})
