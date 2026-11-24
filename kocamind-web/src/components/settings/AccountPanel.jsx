import { useState } from "react";
import { IconDelete, IconProfile, IconSignOut } from "../icons.jsx";
import { auth, updateProfile } from "../../lib/firebase";
import { ConfirmDialog } from "../Dialogs";
import { ChipSelect, Field, SettingsGroup, LinkRow, SwitchRow } from "./Fields";

// Ayarlar > Hesap: kompakt profil satırı, ad düzenleme ve konum tercihi.
// Oturumu kapatma ve hesabı silme, Hesap sekmesinin en altındaki AccountDangerZone'dadır.
export default function AccountPanel({ currentUser, isPro, locationEnabled, setLocationEnabled, locationQueryTypes, toggleLocationType, showToast, onProfileUpdated }) {
  const savedName = currentUser?.displayName || ''
  const [name, setName] = useState(savedName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  if (!currentUser) {
    return (
      <div className="settings-empty">
        <IconProfile size={36} />
        <p>Profilini düzenlemek için giriş yapmalısın.</p>
      </div>
    )
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateProfile(auth.currentUser, { displayName: name.trim() })
      onProfileUpdated?.()
      showToast('Profil güncellendi', 'success')
    } catch (e) {
      setError(e.message || 'Ad kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  const initial = (name || currentUser.email || 'U').trim()[0]?.toLocaleUpperCase('tr')

  return (
    <>
      <div className="profile-summary-row">
        {currentUser.photoURL
          ? <img src={currentUser.photoURL} alt="" className="profile-summary-avatar" referrerPolicy="no-referrer" />
          : <span className="profile-summary-avatar fallback">{initial}</span>}
        <div className="profile-summary-info">
          <span className="profile-summary-name">{savedName || 'İsimsiz kullanıcı'}</span>
          <span className="profile-summary-email">{currentUser.email}</span>
        </div>
        <span className="settings-plan-pill">{isPro ? 'Plus' : 'Ücretsiz plan'}</span>
      </div>

      <Field label="Ad">
        <div className="profile-name-row">
          <input
            type="text"
            className="settings-text-input"
            value={name}
            maxLength={60}
            aria-label="Ad"
            onChange={e => { setName(e.target.value); setError(null) }}
          />
          <button type="button" className="create-btn primary" onClick={save} disabled={saving || !name.trim() || name.trim() === savedName}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
        {error && <p className="settings-error">{error}</p>}
      </Field>

      <SettingsGroup>
        <SwitchRow
          label="Tüm cihazlarda konum kullanımı"
          desc="Konumunu kullanarak daha iyi öneriler sunar"
          checked={locationEnabled}
          onChange={() => setLocationEnabled(v => !v)}
        />
      </SettingsGroup>

      {locationEnabled && (
        <Field label="Konum kullanım alanları" hint="Hangi sorgularda konumun kullanılsın?">
          <ChipSelect
            options={['Hava Durumu', 'Restoran Önerileri', 'Navigasyon', 'Etkinlikler', 'Alışveriş']}
            selected={locationQueryTypes}
            onToggle={toggleLocationType}
          />
        </Field>
      )}
    </>
  )
}

// Hesap sekmesinin en altı: oturumu kapat ve hesabı sil, onay penceresiyle.
export function AccountDangerZone({ onLogout, onClose, onDeleteAccount }) {
  const [confirm, setConfirm] = useState(null)
  return (
    <>
      <SettingsGroup>
        <LinkRow label="Oturumu kapat" onClick={() => setConfirm('logout')} />
        <LinkRow label="Hesabı sil" desc="Hesap kilitlenir, veriler 60 gün sonra silinir" danger onClick={() => setConfirm('delete')} />
      </SettingsGroup>

      {confirm === 'logout' && (
        <ConfirmDialog
          title="Çıkış yap"
          message="Hesabından çıkış yapmak istediğine emin misin?"
          action="Çıkış yap"
          icon={IconSignOut}
          onConfirm={() => { onLogout?.(); onClose() }}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title="Hesabı sil"
          message="Hesabın hemen kilitlenir. Sohbetlerin, hafızan ve dosyaların 60 gün sonra kalıcı olarak silinir; bu süre içinde giriş yapıp geri alabilirsin."
          action="Hesabı sil"
          danger
          confirmWord="SİL"
          icon={IconDelete}
          onConfirm={onDeleteAccount}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  )
}
