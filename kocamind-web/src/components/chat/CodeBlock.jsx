import { lazy, Suspense, useState } from "react";
import { IconCode, IconPreview } from "../icons.jsx";
import { CopyButton } from "./CopyButton";

export const MAX_HIGHLIGHTED_CODE_LENGTH = 12000

export const SyntaxHighlighter = lazy(() => import('../SyntaxHighlighter'))

export function CodeBlock({ children, className, ...rest }) {
  const match = /language-(\w+)/.exec(className || '')
  const code = String(children).replace(/\n$/, '')
  const isPreviewable = match && ['html', 'htm'].includes(match[1].toLowerCase())
  const [showPreview, setShowPreview] = useState(!!isPreviewable)
  if (match) {
    const isLarge = code.length > MAX_HIGHLIGHTED_CODE_LENGTH || code.split('\n').length > 300
    const showPlainCode = isLarge || !isPreviewable || !showPreview
    return (
      <div className={`code-block-wrapper ${isLarge ? 'code-block-large' : ''}`}>
        <div className="code-block-header">
          <span className="code-lang">{match[1]}</span>
          <div className="code-block-tools">
            {isPreviewable && (
              <button className="code-view-toggle" onClick={() => setShowPreview(value => !value)} title={showPreview ? 'Kodu göster' : 'Önizlemeyi göster'}>
                {showPreview ? <><IconCode size={14} /> Kod</> : <><IconPreview size={14} /> Önizleme</>}
              </button>
            )}
            {showPlainCode && <CopyButton text={code} className="code-copy-btn" />}
          </div>
        </div>
        {showPreview ? (
          <iframe className="code-preview-frame" title="HTML önizleme" sandbox="allow-scripts" srcDoc={code} />
        ) : isLarge ? (
          <pre className="code-block-plain" {...rest}><code>{code}</code></pre>
        ) : (
          <Suspense fallback={<pre className="code-block-plain"><code>{code}</code></pre>}>
            <SyntaxHighlighter language={match[1]} {...rest}>{code}</SyntaxHighlighter>
          </Suspense>
        )}
      </div>
    )
  }
  return <code className={className} {...rest}>{children}</code>
}
