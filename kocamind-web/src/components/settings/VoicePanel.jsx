import { IconVoiceSettings } from "../icons.jsx";
import { setPref, speak, useAppPrefs, VOICE_LANGS, VOICE_RATES, voicePreviewText } from "../../lib/appPrefs";
import { SegmentedControl, SettingRow, SettingsGroup } from "./Fields";

// Ayarlar > Ses: sesli okuma dili, hızı ve önizleme.
export default function VoicePanel({ showToast }) {
  const prefs = useAppPrefs()
  const preview = () => {
    if (!speak(voicePreviewText(prefs.voiceLang))) showToast?.('Tarayıcın sesli okumayı desteklemiyor.', 'info')
  }
  return (
    <SettingsGroup>
      <SettingRow
        label="Dil"
        control={<SegmentedControl options={VOICE_LANGS} value={prefs.voiceLang} onChange={value => setPref('voiceLang', value)} label="Sesli okuma dili" />}
      />
      <SettingRow
        label="Okuma hızı"
        control={<SegmentedControl options={VOICE_RATES} value={prefs.voiceRate} onChange={value => setPref('voiceRate', value)} label="Okuma hızı" />}
      />
      <SettingRow
        label="Sesli okuma önizlemesi"
        desc="Yanıtın altındaki hoparlör düğmesi bu ayarlarla okur"
        control={
          <button type="button" className="mini-btn" onClick={preview}>
            <IconVoiceSettings size={15} /> Önizle
          </button>
        }
      />
    </SettingsGroup>
  )
}
