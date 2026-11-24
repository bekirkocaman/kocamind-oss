import { LinkRow, SettingsGroup } from "./Fields";

const FEEDBACK_MAIL = `mailto:destek@kocamind.com?subject=${encodeURIComponent('KocaMind Destek')}`

// Ayarlar > Yardım > Hakkında.
export default function AboutPanel() {
  return (
    <SettingsGroup>
      <LinkRow label="Bize ulaşın" value="destek@kocamind.com" href={FEEDBACK_MAIL} />
      <LinkRow label="Gizlilik politikası" href="/privacy.html" />
      <LinkRow label="Kullanım koşulları" href="/terms.html" />
      <LinkRow label="Sürüm" value="Web" />
    </SettingsGroup>
  )
}
