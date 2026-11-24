import { useEffect, useState } from 'react'
import { LogoMark } from './chat/LogoMark'
import './PendingDeletion.css'

const formatDate = iso => iso
  ? new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  : null

const daysLeft = iso => iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400000)) : null

export default function PendingDeletion({ email, loadStatus, onRestore, onDeleteNow, onLogout }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    loadStatus().then(data => { if (active) setStatus(data) }).catch(() => {})
    return () => { active = false }
  }, [loadStatus])

  const run = async (kind, action) => {
    setBusy(kind)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err.message)
      setBusy(null)
    }
  }

  const deleteNow = () => {
    const confirmation = window.prompt('Hesabın ve tüm verilerin hemen, geri alınamaz şekilde silinecek. Devam etmek için HESABIMI SİL yaz:')
    if (confirmation !== 'HESABIMI SİL') return
    run('delete', onDeleteNow)
  }

  const remaining = daysLeft(status?.purgeAfter)

  return (
    <div className="pending-deletion">
      <div className="pending-deletion-card" role="alertdialog" aria-labelledby="pending-deletion-title">
        <LogoMark size={36} />
        <h1 id="pending-deletion-title">Hesabın silinmeye planlandı</h1>
        <p>
          <strong>{email}</strong> hesabın kilitli.
          {status?.purgeAfter
            ? <> Sohbetlerin, hafızan ve dosyaların <strong>{formatDate(status.purgeAfter)}</strong> tarihinde ({remaining} gün sonra) kalıcı olarak silinecek.</>
            : ' Verilerin 60 günlük bekleme süresinin sonunda kalıcı olarak silinecek.'}
        </p>
        <p className="pending-deletion-muted">Fikrini değiştirdiysen hesabını geri alabilirsin; her şey kaldığı yerden devam eder.</p>
        {error && <p className="pending-deletion-error" role="alert">{error}</p>}
        <button className="pending-deletion-primary" onClick={() => run('restore', onRestore)} disabled={busy !== null}>
          {busy === 'restore' ? 'Geri alınıyor…' : 'Hesabımı geri al'}
        </button>
        <button className="danger-btn" onClick={deleteNow} disabled={busy !== null}>
          {busy === 'delete' ? 'Siliniyor…' : 'Beklemeden şimdi kalıcı olarak sil'}
        </button>
        <button className="pending-deletion-link" onClick={onLogout} disabled={busy !== null}>Çıkış yap</button>
      </div>
    </div>
  )
}
