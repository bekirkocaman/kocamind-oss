import { useCallback, useEffect, useState } from "react";
import { CONNECTOR_ICONS, GMAIL_CONNECTOR } from "./options";
import {
  IconCheck,
  IconConnect,
  IconConnectorFallback,
  IconDisconnect,
  IconLoading,
  IconRetry,
  IconWarning,
} from "../icons.jsx";
import { listConnectors, startConnector, disconnectConnector, connectorButtonState } from "../../lib/connectors";
import { ConfirmDialog } from "../Dialogs";
import { SettingsGroup, SkeletonRows } from "./Fields";

// Ayarlar > Bağlantılar (Android ConnectorsScreen): liste sunucu kataloğundan gelir; Gmail web'e özgü
// salt okunur bağlantıdır. Bağlantıyı kesmeden önce onay istenir.
export default function ConnectorsPanel({ gmailConnection, onDisconnectGmail, onConnectGmail, isConnectingGmail, currentUser, showToast }) {
  const [catalog, setCatalog] = useState(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [askDisconnect, setAskDisconnect] = useState(null)

  const refresh = useCallback(async () => {
    setFailed(false)
    try {
      setCatalog(await listConnectors())
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    if (!currentUser) return undefined
    let cancelled = false
    listConnectors()
      .then(data => { if (!cancelled) setCatalog(data) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [currentUser])

  const connect = async info => {
    setBusyId(info.id)
    try {
      await startConnector(info.id)
    } catch (error) {
      showToast?.(error.message || 'Bağlantı başlatılamadı.', 'error')
      setBusyId(null)
    }
  }

  const disconnect = async info => {
    setBusyId(info.id)
    try {
      await disconnectConnector(info.id)
      showToast?.(`${info.label} bağlantısı kesildi.`, 'success')
      await refresh()
    } catch (error) {
      showToast?.(error.message || 'Bağlantı kesilemedi.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const serverButton = info => {
    const state = connectorButtonState(info, catalog)
    if (busyId === info.id) return <button className="connector-btn" disabled><IconLoading size={14} className="spin" /> Bekle</button>
    switch (state.kind) {
      case 'connected': return (
        <button className="connector-btn disconnect" onClick={() => setAskDisconnect(info)} title="Bağlantıyı kes">
          <IconDisconnect size={14} /> Bağlantıyı kes
        </button>
      )
      case 'reauth': return <button className="connector-btn" onClick={() => connect(info)}><IconWarning size={14} /> Yeniden bağla</button>
      case 'plus': return <button className="connector-btn" disabled>Plus gerekli</button>
      case 'connect': return <button className="connector-btn primary" onClick={() => connect(info)}><IconConnect size={14} /> Bağla</button>
      default: return <button className="connector-btn" disabled>Yakında</button>
    }
  }

  const status = info => {
    if (!info.connected) return null
    return info.status === 'reauth'
      ? <span className="connector-status warn">Yeniden bağlanman gerekiyor</span>
      : <span className="connector-status ok"><IconCheck size={12} /> Bağlı</span>
  }

  const gmailConnected = Boolean(gmailConnection)

  return (
    <div className="settings-section">
      <h3>Bağlantılar</h3>
      <p className="settings-hint">Hesaplarını bağla, KocaMind sohbette takvimine, dosyalarına ve notlarına bakabilsin. Bir şey eklemek ya da değiştirmek için her zaman onayını ister. Bağlantı bilgilerin şifreli saklanır ve istediğin an kesebilirsin.</p>

      {!currentUser ? (
        <p className="settings-hint">Bağlantılar için giriş yap.</p>
      ) : failed && !catalog ? (
        <SettingsGroup>
          <div className="connector-row">
            <div className="connector-info"><span className="connector-name">Bağlantılar yüklenemedi</span><span className="connector-desc">İnternet bağlantını kontrol et.</span></div>
            <button className="connector-btn" onClick={refresh}><IconRetry size={14} /> Tekrar dene</button>
          </div>
        </SettingsGroup>
      ) : !catalog ? (
        <SkeletonRows count={4} />
      ) : (
        <>
          {!catalog.enabled && <p className="settings-hint">Bağlantılar çok yakında açılıyor.</p>}
          <SettingsGroup>
            {(catalog.connectors || []).map(info => {
              const Icon = CONNECTOR_ICONS[info.id] || IconConnectorFallback
              return (
                <div key={info.id} className="connector-row">
                  <span className="connector-icon-circle"><Icon size={19} /></span>
                  <div className="connector-info">
                    <span className="connector-name">{info.label}</span>
                    <span className="connector-desc">{info.description}</span>
                    {status(info)}
                  </div>
                  {serverButton(info)}
                </div>
              )
            })}
          </SettingsGroup>
        </>
      )}

      <h4>Web'e özel</h4>
      <SettingsGroup>
        <div className="connector-row gmail-connector-row">
          <span className="connector-icon-circle"><GMAIL_CONNECTOR.icon size={19} /></span>
          <div className="connector-info">
            <span className="connector-name">{GMAIL_CONNECTOR.name}</span>
            <span className="connector-desc">{gmailConnected ? gmailConnection.email : GMAIL_CONNECTOR.desc}</span>
            {gmailConnected && <span className="connector-status ok"><IconCheck size={12} /> Bağlı</span>}
          </div>
          <button
            className={`connector-btn ${gmailConnected ? 'disconnect' : 'primary'}`}
            onClick={gmailConnected ? onDisconnectGmail : onConnectGmail}
            disabled={isConnectingGmail}
          >
            {isConnectingGmail ? <><IconLoading size={14} className="spin" /> Bağlanıyor</> : gmailConnected ? <><IconDisconnect size={14} /> Bağlantıyı kes</> : <><IconConnect size={14} /> Bağla</>}
          </button>
          {!gmailConnected && (
            <div className="gmail-consent-disclosure">
              <strong>Bağlamadan önce:</strong> KocaMind, yalnızca sen istediğinde son iletilerinin gönderen, konu, tarih ve kısa önizleme bilgilerini okur. E-posta gönderemez, silemez veya değiştiremez. Gmail verileri yapay zekâ sağlayıcılarına aktarılmaz ve kalıcı olarak saklanmaz. Düğmeye basarak Google’ın salt okunur Gmail izin ekranına geçersin. <a href="/privacy.html" target="_blank" rel="noreferrer">Gizlilik ayrıntıları</a>
            </div>
          )}
        </div>
      </SettingsGroup>

      {askDisconnect && (
        <ConfirmDialog
          title={`${askDisconnect.label} bağlantısı kesilsin mi?`}
          message="KocaMind bu hesaba artık erişemez. İstediğin zaman yeniden bağlayabilirsin."
          action="Bağlantıyı kes"
          danger
          icon={IconDisconnect}
          onConfirm={() => disconnect(askDisconnect)}
          onClose={() => setAskDisconnect(null)}
        />
      )}
    </div>
  )
}
