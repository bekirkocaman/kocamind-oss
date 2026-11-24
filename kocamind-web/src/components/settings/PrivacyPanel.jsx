import { useEffect, useState } from "react";
import { getLearningStyle, setLearningStyleEnabled } from "../../lib/api";
import { LinkRow, SelectControl, SettingRow, SettingsGroup, SwitchRow } from "./Fields";
import { RETENTION_OPTIONS } from "./options";

const STYLE_LABELS = { kisa: "Şu an: kısa cevaplar", detayli: "Şu an: ayrıntılı cevaplar" }

function LearnedStyleRow() {
  const [style, setStyle] = useState(null)

  useEffect(() => {
    getLearningStyle().then(setStyle).catch(() => setStyle(null))
  }, [])

  if (!style) return null

  const toggle = () => {
    const next = !style.enabled
    setStyle({ ...style, enabled: next })
    setLearningStyleEnabled(next).then(setStyle).catch(() => setStyle(style))
  }

  return (
    <SwitchRow
      label="Yanıt tarzını öğren"
      desc={`Beğendiğin ve beğenmediğin cevaplardan kısa mı ayrıntılı mı cevap istediğini öğrenir.${style.enabled && STYLE_LABELS[style.length] ? ' ' + STYLE_LABELS[style.length] : ''}`}
      checked={style.enabled}
      onChange={toggle}
    />
  )
}

// Hafıza aç/kapa ve otomatik hafıza anahtarları yalnızca Hafıza sekmesinde (MemoryPanel) durur.
export default function PrivacyPanel({ searchInHistory, setSearchInHistory, dataRetention, setDataRetention }) {
  return (
    <SettingsGroup>
      <SwitchRow
        label="Geçmiş sohbetlerde arama"
        desc="AI, eski konuşmalarından referans alabilir"
        checked={searchInHistory}
        onChange={() => setSearchInHistory(v => !v)}
      />
      <LearnedStyleRow />
      <SettingRow
        label="Sohbet geçmişini sakla"
        desc="Sohbet geçmişin ne kadar süreyle saklansın?"
        control={
          <SelectControl
            options={RETENTION_OPTIONS}
            value={dataRetention}
            onChange={setDataRetention}
            label="Sohbet geçmişini sakla"
          />
        }
      />
      <LinkRow label="Gizlilik politikası" href="/privacy.html" />
    </SettingsGroup>
  );
}
