import { expect, it } from 'vitest'
import { cssImageUrls } from '../../src/core/cssImageUrls'

it('keeps multiple quoted/unquoted references and their original spelling and order', () => {
  const css = 'background:linear-gradient(#fff,#ddd), URL(  "/fixture/图像 1.png?fit=3%3A2"  ), url(/fixture/preview.png#local), Url(\'/fixture/第三张.png\'); color:red'
  expect(cssImageUrls(css)).toEqual(['/fixture/图像 1.png?fit=3%3A2', '/fixture/preview.png#local', '/fixture/第三张.png'])
})
it('retains parentheses and quote characters only as content inside a matching outer quote', () => {
  const css = 'background: url("/fixture/a(b).png"),url(\'/fixture/a"b.png\'),url("/fixture/a\'b.png");'
  expect(cssImageUrls(css)).toEqual(['/fixture/a(b).png', '/fixture/a"b.png', "/fixture/a'b.png"])
})
it('does not treat a url-looking substring inside an already consumed quoted value as another URL', () => {
  expect(cssImageUrls('url("/fixture/name-url(inner).png") url(/fixture/next.png)'))
    .toEqual(['/fixture/name-url(inner).png', '/fixture/next.png'])
})
it('preserves the legacy unquoted fallback when there is no matching closing quote', () => {
  expect(cssImageUrls('url("unterminated.png)\n url(/fixture/next.png)'))
    .toEqual(['"unterminated.png', '/fixture/next.png'])
})
it('keeps empty references for the caller to reject and ignores a missing closing delimiter', () => {
  expect(cssImageUrls('url() url(    ) url(\'\') url("") url(/fixture/incomplete'))
    .toEqual(['', '', '', ''])
})
it.each(['\n', '\r', '\u2028', '\u2029'])('skips an interrupted value at line break %# and still finds later references', (br) => {
  const css = "url('broken" + br + "value.png') url(" + br + "/fixture/after.png" + br + ")"
  expect(cssImageUrls(css)).toEqual(['/fixture/after.png'])
})
it('finds no references in plain styles or empty input', () => {
  expect(cssImageUrls('background-color:#fff; border-radius:8px')).toEqual([])
  expect(cssImageUrls('')).toEqual([])
})
