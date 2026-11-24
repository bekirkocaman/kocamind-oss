import { THEME_OPTIONS } from "../../lib/theme";
import { setPref, useAppPrefs } from "../../lib/appPrefs";
import { FONTS, REPLY_FONTS } from "./options";
import { SegmentedControl, SelectControl, SettingRow, SettingsGroup, SwitchRow } from "./Fields";

// Ayarlar > Genel > Görünüm: renk modu, yanıt yazı tipi, arayüz yazısı, azaltılmış hareket.
export default function AppearancePanel({ theme, setTheme, font, setFont }) {
  const prefs = useAppPrefs()
  return (
    <SettingsGroup>
      <SettingRow
        label="Renk modu"
        control={<SegmentedControl options={THEME_OPTIONS} value={theme} onChange={setTheme} label="Renk modu" />}
      />
      <SettingRow
        label="Yanıt yazı tipi"
        desc="Yapay zekânın yanıtlarında kullanılan yazı tipi"
        control={<SegmentedControl options={REPLY_FONTS} value={prefs.replyFont} onChange={value => setPref('replyFont', value)} label="Yanıt yazı tipi" />}
      />
      <SettingRow
        label="Arayüz yazısı"
        desc="Okuma kolaylığı için arayüzün yazı tipini değiştir"
        control={<SelectControl options={FONTS} value={font} onChange={setFont} label="Arayüz yazısı" />}
      />
      <SwitchRow
        label="Azaltılmış hareket"
        desc="Animasyonları en aza indirir"
        checked={prefs.reduceMotion}
        onChange={() => setPref('reduceMotion', !prefs.reduceMotion)}
      />
    </SettingsGroup>
  )
}
