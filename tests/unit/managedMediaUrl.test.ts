import { describe, expect, it } from 'vitest'
import { variantUrl } from '../../src/core/compiler'

describe('generation-qualified managed media variants', () => {
  const generation = 'ab'.repeat(32)
  const source = '/media/fixture-image.png'

  it('preserves just the validated generation when selecting the rendered crop', () => {
    expect(variantUrl(source + '?w=999&gen=' + generation + '#ignored', '1:1', 160))
      .toEqual(source + '?fit=1%3A1&w=160&gen=' + generation)
  })

  it('never promotes malformed, duplicate, or non-managed generation parameters', () => {
    expect(variantUrl(source + '?gen=unknown', undefined, 160)).toEqual(source + '?w=160')
    expect(variantUrl(source + '?gen=' + generation + '&gen=' + generation, undefined, 160)).toEqual(source + '?w=160')
    expect(variantUrl('https://example.test/image.png?gen=' + generation, undefined, 160))
      .toEqual('https://example.test/image.png?gen=' + generation)
  })
})
