/** Install copy actions in the standalone template preview. */
export function installTemplateInteractions(window) {
  const { document, navigator, ClipboardItem, Blob, setTimeout, clearTimeout } = window
  // 复制：优先 ClipboardItem（text/html），失败时用 copy 事件写入，二者都只写入模块本身的 HTML
  async function copyHtml(html, text) {
    try {
      if (navigator.clipboard && window.ClipboardItem && window.isSecureContext) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })])
        return true
      }
    } catch { /* 退回 execCommand */ }
    let ok = false
    const onCopy = (e) => { e.clipboardData.setData('text/html', html); e.clipboardData.setData('text/plain', text); e.preventDefault(); ok = true }
    document.addEventListener('copy', onCopy)
    try { document.execCommand('copy') } catch { return false } finally { document.removeEventListener('copy', onCopy) }
    return ok
  }
  const toast = (msg) => { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2600) }
  const stageHtml = (demo) => demo.querySelector('.stage').innerHTML.trim()
  document.querySelectorAll('.demo').forEach((demo) => {
    const btn = demo.querySelector('.copy')
    btn.addEventListener('click', async () => {
      const ok = await copyHtml(stageHtml(demo), demo.querySelector('.stage').innerText)
      toast(ok ? '已复制「' + demo.dataset.name + '」，到公众号后台 Ctrl+V 粘贴' : '复制失败：请换用 Chrome / Edge 打开本文件')
      if (ok) { btn.classList.add('done'); btn.textContent = '✓ 已复制'; setTimeout(() => { btn.classList.remove('done'); btn.textContent = '📋 复制此模块到公众号' }, 1800) }
    })
  })
  document.getElementById('copy-all').addEventListener('click', async () => {
    const demos = [...document.querySelectorAll('.demo')]
    const ok = await copyHtml(demos.map(stageHtml).join(''), document.getElementById('article').innerText)
    toast(ok ? '已复制整篇示例（' + demos.length + ' 个模块）' : '复制失败：请换用 Chrome / Edge 打开本文件')
  })

}
