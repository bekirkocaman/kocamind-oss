import { Prism } from 'react-syntax-highlighter'

// Sakin, temaya uyan sözdizimi paleti. Renkler App.css'te `.code-block-wrapper` üzerinde
// tanımlı `--code-*` değişkenlerinden gelir; açık/koyu tema geçişinde kendiliğinden değişir.
const tone = (name) => ({ color: `var(--code-${name})` })

const calmTheme = {
  'pre[class*="language-"]': {
    margin: 0,
    padding: '14px 16px',
    overflow: 'auto',
    background: 'var(--code-bg)',
    color: 'var(--code-text)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13.5px',
    lineHeight: 1.6,
    tabSize: 2,
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    hyphens: 'none',
    textAlign: 'left',
  },
  'code[class*="language-"]': {
    background: 'none',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    whiteSpace: 'pre',
    tabSize: 2,
  },
  comment: { ...tone('comment'), fontStyle: 'italic' },
  prolog: tone('comment'),
  doctype: tone('comment'),
  cdata: tone('comment'),
  punctuation: tone('punctuation'),
  operator: tone('punctuation'),
  property: tone('property'),
  'attr-name': tone('property'),
  tag: tone('keyword'),
  keyword: tone('keyword'),
  atrule: tone('keyword'),
  selector: tone('keyword'),
  important: tone('keyword'),
  boolean: tone('number'),
  number: tone('number'),
  constant: tone('number'),
  symbol: tone('number'),
  string: tone('string'),
  char: tone('string'),
  'attr-value': tone('string'),
  regex: tone('string'),
  inserted: tone('string'),
  url: tone('string'),
  deleted: tone('keyword'),
  function: tone('function'),
  'class-name': tone('type'),
  builtin: tone('type'),
  entity: tone('type'),
  variable: tone('text'),
  bold: { fontWeight: 600 },
  italic: { fontStyle: 'italic' },
}

export default function SyntaxHighlighter({ language, children, ...rest }) {
  return (
    <Prism
      style={calmTheme}
      language={language}
      PreTag="div"
      customStyle={{ margin: 0 }}
      {...rest}
    >
      {children}
    </Prism>
  )
}
