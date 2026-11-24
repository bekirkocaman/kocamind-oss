import { ChipSelect, Field } from "./Fields";
import { OCCUPATIONS } from "./options";

// Ayarlar > Kişiselleştirme > Özel talimatlar: hitap, meslek ve her sohbete eklenen talimatlar.
export default function GeneralPanel({ userName, setUserName, aiName, setAiName, occupations, toggleOccupations, preferences, setPreferences }) {
  return (
    <>
      <Field label="Kullanıcı adı" hint="AI sana nasıl hitap etsin?">
        <input
          type="text"
          className="settings-text-input"
          placeholder="Adın"
          value={userName}
          onChange={e => setUserName(e.target.value)}
        />
      </Field>

      <Field label="Asistan adı" hint="AI asistanına vereceğin isim">
        <input
          type="text"
          className="settings-text-input"
          placeholder="KocaMind"
          value={aiName}
          onChange={e => setAiName(e.target.value)}
        />
      </Field>

      <Field label="Ne iş yapıyorsun?" hint="Cevaplarımı sana göre şekillendireyim">
        <ChipSelect options={OCCUPATIONS} selected={occupations} onToggle={toggleOccupations} />
      </Field>

      <Field label="Ek talimatlar" hint="AI'ın davranışını özelleştir; yazdıkların her sohbete otomatik eklenir">
        <textarea
          className="settings-textarea"
          placeholder="Örn: Kısa cevaplar ver, teknik terimleri açıkla, esprili ol..."
          value={preferences}
          onChange={e => setPreferences(e.target.value)}
          rows={4}
        />
      </Field>
    </>
  );
}
