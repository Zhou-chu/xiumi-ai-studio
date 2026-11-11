import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ColorModeProvider } from './editor/ColorModeControl'
import { ErrorBoundary } from './editor/ErrorBoundary'
import { saveBeforeLeave, useStore } from './editor/store'
import './styles.css'
import './help.css'
import './color-mode.css'
import './responsive.css'

/** 最外层兜底：任何未捕获的渲染错误都显示可恢复的提示，而不是白屏 */
function Crashed({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="crash">
      <h2>编辑器遇到错误</h2>
      <p>{error.message}</p>
      <p className="hint">可以先撤销最近一步操作；重新加载前会尝试保存，保存失败时会保留当前页面。</p>
      <div className="row gap">
        <button
          className="primary"
          onClick={() => {
            useStore.getState().undo()
            reset()
          }}
        >
          撤销上一步并恢复
        </button>
        <button onClick={async () => { if (await saveBeforeLeave()) location.reload() }}>重新加载</button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ColorModeProvider>
    <ErrorBoundary fallback={(error, reset) => <Crashed error={error} reset={reset} />}>
      <App />
    </ErrorBoundary>
    </ColorModeProvider>
  </StrictMode>,
)
