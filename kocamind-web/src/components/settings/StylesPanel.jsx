import { TONE_PRESETS } from "./options";
import { IconCreateStyle } from "../icons.jsx";
import { Field, SegmentedControl, SettingRow, SettingsGroup } from "./Fields";

const TONE_OPTIONS = TONE_PRESETS.map(t => ({ id: t.id, label: t.name }))

export default function StylesPanel({ activeTone, handleSelectTone, customStyleText, setCustomStyleText, handleCreateStyle, customStylePrompt }) {
  const activePreset = TONE_PRESETS.find(t => t.id === activeTone)
  const toneDesc = activeTone === 'custom'
    ? 'Özel stilin aktif'
    : activePreset?.desc || "AI'ın sana nasıl cevap vereceğini belirle"

  return (
    <>
      <SettingsGroup>
        <SettingRow
          label="Yanıt tonu"
          desc={toneDesc}
          control={
            <SegmentedControl
              options={TONE_OPTIONS}
              value={activeTone}
              onChange={handleSelectTone}
              label="Yanıt tonu"
            />
          }
        />
      </SettingsGroup>

      <Field label="Özel stil oluştur" hint="Kendi yazdığın bir metni yapıştır, AI senin tarzını öğrensin.">
        <textarea
          className="settings-textarea"
          placeholder="Buraya kendi yazdığın örnek bir metin yapıştır... (en az 100 karakter)"
          value={customStyleText}
          onChange={e => setCustomStyleText(e.target.value)}
          rows={5}
        />
        <div>
          <button
            type="button"
            className="create-btn"
            style={{ marginTop: 8 }}
            disabled={customStyleText.trim().length < 100}
            onClick={handleCreateStyle}
          >
            <IconCreateStyle size={15} /> Bu tarzdan stil oluştur
          </button>
        </div>
        {customStylePrompt && (
          <div className="settings-note" style={{ marginTop: 8 }}>
            Oluşturulan stil aktif. AI artık senin tarzında cevap verecek.
          </div>
        )}
      </Field>
    </>
  );
}
