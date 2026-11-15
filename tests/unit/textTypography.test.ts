import { expect, it } from 'vitest'
import { compileBlock } from '../../src/core/compiler'
import { sampleReplay, renderReplay } from '../../src/core/replay'
import { THEMES } from '../../src/core/themes'
const theme = THEMES[0]
it('keeps replay compilation on its original renderer and identifier contract', () => {
  const props = sampleReplay(), id = 'replay-typography'
  expect(compileBlock({ id, type: 'replay', props }, theme)).toBe(renderReplay(props, { idPrefix: 'rpreplay' }).html)
})
