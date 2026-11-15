// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { pickElement } from '../../src/core/fragments'

it('treats a stale detached inline selection as outside the fragment root', () => {
  const root = document.createElement('div')
  const selected = document.createElement('strong')
  root.append(selected)
  selected.remove()
  expect(pickElement(selected, root)).toBeNull()
})

it('does not pick inline text from a different fragment root', () => {
  const root = document.createElement('div')
  const different = document.createElement('div')
  different.innerHTML = '<p>Outside <span>text</span></p>'
  expect(pickElement(different.querySelector('span')!, root)).toBeNull()
  expect(different.textContent).toBe('Outside text')
})

it('does not pick an inline root itself', () => {
  const root = document.createElement('span')
  root.textContent = 'Unchanged'
  expect(pickElement(root, root)).toBeNull()
  expect(root.textContent).toBe('Unchanged')
})
