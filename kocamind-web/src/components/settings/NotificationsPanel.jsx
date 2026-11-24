import { useState } from "react";
import { enableReplyNotifications, notificationsSupported, setPref, useAppPrefs } from "../../lib/appPrefs";
import { SettingsGroup, SwitchRow } from "./Fields";

// Ayarlar > Bildirimler: sekme arka plandayken biten yanıt bildirilir.
export default function NotificationsPanel() {
  const prefs = useAppPrefs()
  const supported = notificationsSupported()
  const [denied, setDenied] = useState(() => supported && Notification.permission === 'denied')
  const granted = supported && Notification.permission === 'granted'

  const toggle = async () => {
    if (prefs.notifyReplies && granted) { setPref('notifyReplies', false); return }
    const permission = await enableReplyNotifications()
    setDenied(permission === 'denied')
  }

  return (
    <>
      <SettingsGroup>
        <SwitchRow
          label="Yanıt hazır olunca bildir"
          desc="KocaMind sekmesi arka plandayken yanıt bitince haber verir"
          checked={prefs.notifyReplies && granted}
          disabled={!supported}
          onChange={toggle}
        />
      </SettingsGroup>
      {!supported && <p className="settings-hint">Bu tarayıcı bildirimleri desteklemiyor.</p>}
      {denied && <p className="settings-hint">Bildirim izni verilmedi. Tarayıcının site ayarlarından KocaMind için bildirimlere izin verebilirsin.</p>}
    </>
  )
}
