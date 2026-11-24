import { Component } from 'react'
import { reportClientError } from '../lib/telemetry'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary yakaladı:', error, errorInfo)
    reportClientError(error, { componentStack: errorInfo?.componentStack })
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  handleClearData = () => {
    try { localStorage.clear() } catch { /* yoksay */ }
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', padding: '2rem', textAlign: 'center',
        background: 'var(--bg, #111113)', color: 'var(--text, #e1e1e3)',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Bir şeyler ters gitti</h1>
        <p style={{ color: 'var(--text-secondary, #888)', marginBottom: '2rem', maxWidth: 500 }}>
          Uygulama beklenmeyen bir hatayla karşılaştı. Sayfayı yenilemeyi dene.
        </p>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={this.handleReload} style={{
            padding: '0.75rem 1.5rem', borderRadius: '8px', border: 'none',
            background: 'var(--accent, #4c6ef5)', color: '#fff', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 600,
          }}>
            Sayfayı yenile
          </button>
          <button onClick={this.handleClearData} style={{
            padding: '0.75rem 1.5rem', borderRadius: '8px', border: '1px solid var(--border, #333)',
            background: 'transparent', color: 'var(--text, #e1e1e3)', cursor: 'pointer',
            fontSize: '1rem',
          }}>
            Yerel verileri temizle
          </button>
        </div>
        {this.state.error && (
          <details style={{ marginTop: '2rem', maxWidth: 600, textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-secondary, #888)' }}>Hata detayı</summary>
            <pre style={{ fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {this.state.error.message}
            </pre>
          </details>
        )}
      </div>
    )
  }
}
