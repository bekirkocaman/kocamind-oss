import { IconCheck, IconExpand } from "../icons.jsx";

export function Toggle({ checked, onChange, disabled = false, title }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`plugin-toggle ${checked ? 'on' : ''}`} onClick={onChange} disabled={disabled} title={title || (checked ? 'Kapat' : 'Aç')}>
      <span className="plugin-toggle-knob" />
    </button>
  )
}

// 2-4 seçenekli tek seçim için nötr segment kontrolü (turuncu değil).
export function SegmentedControl({ options, value, onChange, label, className = '' }) {
  return (
    <div className={`km-segment ${className}`} role="radiogroup" aria-label={label}>
      {options.map(option => {
        const active = value === option.id
        return (
          <button
            key={String(option.id)}
            type="button"
            role="radio"
            aria-checked={active}
            className={`km-segment-btn ${active ? 'active' : ''}`}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

// 5+ seçenek ya da uzun etiketli tek seçim için stilli native select.
export function SelectControl({ options, value, onChange, label, className = '' }) {
  return (
    <div className={`km-select-wrap ${className}`}>
      <select
        className="km-select"
        aria-label={label}
        value={String(value)}
        onChange={e => {
          const match = options.find(opt => String(opt.id) === e.target.value)
          onChange(match ? match.id : e.target.value)
        }}
      >
        {options.map(option => (
          <option key={String(option.id)} value={String(option.id)}>
            {option.label}
          </option>
        ))}
      </select>
      <IconExpand size={14} className="km-select-caret" />
    </div>
  )
}

export function OptionGroup({ options, value, onChange, className = '' }) {
  return (
    <div className={`settings-option-group ${className}`}>
      {options.map(option => (
        <button type="button" key={option.id} className={`settings-option ${value === option.id ? 'active' : ''}`} onClick={() => onChange(option.id)}>
          {option.icon && <option.icon size={16} />}
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function ChipSelect({ options, selected, onToggle, className = '' }) {
  return (
    <div className={`chip-select ${className}`}>
      {options.map(option => (
        <button type="button" key={option} className={`chip ${selected.includes(option) ? 'active' : ''}`} onClick={() => onToggle(option)}>
          {selected.includes(option) && <IconCheck size={12} />}
          {option}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <div className="settings-field">
      <div className="settings-field-label">{label}</div>
      {hint && <p className="settings-field-hint">{hint}</p>}
      {children}
    </div>
  )
}

// Kartsız düz satır listesi: satırlar arası 1px --border ayraç.
export function SettingsGroup({ children, className = '' }) {
  return <div className={`km-group ${className}`}>{children}</div>
}

// Tek satır deseni: sol etiket 14px 500 + açıklama 13px --text-secondary; sağ kontrol.
export function SettingRow({ label, desc, control, className = '' }) {
  return (
    <div className={`km-row km-setting-row ${className}`}>
      <div className="km-row-text">
        <span className="km-row-label">{label}</span>
        {desc && <span className="km-row-desc">{desc}</span>}
      </div>
      {control && <div className="km-row-control">{control}</div>}
    </div>
  )
}

export function SkeletonRows({ count = 3 }) {
  return (
    <div className="km-group" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="km-row km-skeleton-row">
          <span className="km-skeleton" style={{ width: '38%' }} />
          <span className="km-skeleton" style={{ width: '82%' }} />
        </div>
      ))}
    </div>
  )
}

export function SwitchRow({ label, desc, checked, onChange, disabled, title }) {
  return (
    <div className="km-row">
      <div className="km-row-text">
        <span className="km-row-label">{label}</span>
        {desc && <span className="km-row-desc">{desc}</span>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} title={title || label} />
    </div>
  )
}

export function LinkRow({ label, desc, value, href, onClick, danger = false }) {
  const content = (
    <>
      <div className="km-row-text">
        <span className="km-row-label">{label}</span>
        {desc && <span className="km-row-desc">{desc}</span>}
      </div>
      {value && <span className="km-row-value">{value}</span>}
    </>
  )
  if (href) return <a className={`km-row km-row-link ${danger ? 'danger' : ''}`} href={href} target={href.startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer">{content}</a>
  if (onClick) return <button type="button" className={`km-row km-row-link ${danger ? 'danger' : ''}`} onClick={onClick}>{content}</button>
  return <div className="km-row">{content}</div>
}

export function ChoiceList({ options, value, onChange, preview }) {
  return (
    <div className="km-group" role="radiogroup">
      {options.map(option => (
        <button
          key={String(option.id)}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          className="km-row km-row-link km-choice"
          onClick={() => onChange(option.id)}
        >
          <span className="km-row-label" style={preview ? preview(option.id) : undefined}>{option.label}</span>
          {value === option.id && <IconCheck size={20} className="km-choice-check" />}
        </button>
      ))}
    </div>
  )
}
