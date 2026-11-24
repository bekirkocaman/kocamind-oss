import { BUILT_IN_PLUGINS, isPluginAvailable } from "../../lib/pluginManager";
import { SettingsGroup, SwitchRow } from "./Fields";

export default function PluginsPanel({ availableTools, isPluginEnabled, togglePlugin }) {
  return (
    <div className="settings-section">
      <h3>Eklentiler</h3>
      <p className="settings-hint">KocaMind'ın sohbette kullanabileceği araç eklentilerini açıp kapatabilirsin.</p>
      <SettingsGroup>
        {BUILT_IN_PLUGINS.map(p => {
          const available = isPluginAvailable(p, availableTools)
          return (
            <SwitchRow
              key={p.id}
              label={p.name}
              desc={`${p.description}${!available ? ' · Bağlı değil' : ''}`}
              checked={isPluginEnabled(p)}
              disabled={!available}
              title={!available ? 'Bağlantı yapılandırılmamış' : isPluginEnabled(p) ? 'Kapat' : 'Aç'}
              onChange={() => togglePlugin(p)}
            />
          )
        })}
      </SettingsGroup>
    </div>
  );
}
