import { useState } from "react";
import { IconDelete } from "../icons.jsx";
import { ConfirmDialog } from "../Dialogs";
import { LinkRow, SettingsGroup } from "./Fields";

// Ayarlar > Veri ve Gizlilik > Veri: dışa aktarma, yedekten geri yükleme ve geçmişi temizleme.
export default function DataPanel({ onExportAll, onExportFormat, currentUser, onExportAccount, importRef, onImportChats, showToast, onClearAllChats }) {
  const [askClear, setAskClear] = useState(false)
  return (
    <>
      <div className="settings-section">
        <h3>Sohbetleri dışa aktar</h3>
        <SettingsGroup>
          <LinkRow label="Markdown" desc="Notion, Obsidian ve not uygulamaları için" onClick={() => onExportFormat('markdown')} />
          <LinkRow label="Düz metin" desc="Her cihazda ve uygulamada açılır" onClick={() => onExportFormat('text')} />
          <LinkRow label="Yedek (JSON)" desc="Başka bir cihaza taşımak ya da geri yüklemek için" onClick={onExportAll} />
          {currentUser && <LinkRow label="Tüm hesap verileri" desc="Sohbet, hafıza, geri bildirim ve kullanım kayıtlarının tamamı" onClick={onExportAccount} />}
        </SettingsGroup>
      </div>

      <div className="settings-section">
        <h3>İçe aktar</h3>
        <input type="file" ref={importRef} style={{ display: 'none' }} accept=".json" onChange={async (e) => {
          const file = e.target.files[0]
          if (!file) return
          try {
            const text = await file.text()
            const data = JSON.parse(text)
            if (Array.isArray(data) && onImportChats) {
              onImportChats(data)
            } else {
              showToast('Geçersiz JSON dosyası. KocaMind sohbet yedeği olmalı.', 'error')
            }
          } catch (err) {
            showToast('Dosya okunamadı: ' + err.message, 'error')
          }
          e.target.value = ''
        }} />
        <SettingsGroup>
          <LinkRow label="Yedekten geri yükle" desc="Daha önce indirdiğin JSON dosyasından sohbetleri geri yükle" onClick={() => importRef.current?.click()} />
        </SettingsGroup>
      </div>

      <SettingsGroup>
        <LinkRow
          label="Sohbet geçmişini temizle"
          desc={currentUser ? 'Bu cihazdaki ve buluttaki sohbetler' : 'Bu cihazdaki sohbetler'}
          danger
          onClick={() => setAskClear(true)}
        />
      </SettingsGroup>

      {askClear && (
        <ConfirmDialog
          title="Sohbet geçmişi silinsin mi?"
          message="Tüm sohbet geçmişin silinecek. Bu işlem geri alınamaz."
          action="Sil"
          danger
          icon={IconDelete}
          onConfirm={onClearAllChats}
          onClose={() => setAskClear(false)}
        />
      )}
    </>
  )
}
