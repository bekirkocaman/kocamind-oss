import { SettingsGroup, SwitchRow } from "./Fields";

export default function CapabilitiesPanel({ webSearch, setWebSearch, imageGeneration, setImageGeneration, deepResearch, setDeepResearch, hasPlusAccess, useRag, setUseRag }) {
  return (
    <div className="settings-section">
      <h3>Özellikler</h3>
      <p className="settings-hint">AI'ın sohbetlerde kullanabileceği özellikleri açıp kapatabilirsin.</p>

      <SettingsGroup>
        <SwitchRow
          label="Web arama"
          desc="Güncel bilgiler için internette ücretsiz arama yapar"
          checked={webSearch}
          onChange={() => setWebSearch(v => !v)}
        />
        <SwitchRow
          label="Görsel oluşturma"
          desc="Metin tarifinden görseller üretir"
          checked={imageGeneration}
          onChange={() => setImageGeneration(v => !v)}
        />
        <SwitchRow
          label="Derin araştırma"
          desc={hasPlusAccess ? 'Kapsamlı araştırma yapıp rapor hazırlar' : 'Plus aboneliğine özel'}
          checked={hasPlusAccess && deepResearch}
          disabled={!hasPlusAccess}
          title={hasPlusAccess ? undefined : 'Plus aboneliği gerekli'}
          onChange={() => setDeepResearch(v => !v)}
        />
        <SwitchRow
          label="Dokümanlardan yanıtla"
          desc="Yüklediğin dokümanları kullanarak cevap verir"
          checked={useRag}
          onChange={() => setUseRag(v => !v)}
        />
      </SettingsGroup>
    </div>
  );
}
