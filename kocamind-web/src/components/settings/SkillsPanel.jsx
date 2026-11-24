import { useCallback, useEffect, useState } from "react";
import { IconDelete, IconLoading, IconRetry } from "../icons.jsx";
import { listSkills, removeSkill, groupSkills, skillSourceLabel } from "../../lib/skills";
import { SettingsGroup, SkeletonRows } from "./Fields";

const VISIBLE_LIMIT = 6

// Ayarlar > Skill'ler: yapay zekânın konuya göre kendiliğinden yüklediği talimat paketleri.
// Kullanıcının sohbette kurdurduğu skill'ler ayrı listelenir ve buradan kaldırılabilir.
export default function SkillsPanel({ currentUser, showToast }) {
  const [skills, setSkills] = useState(null)
  const [failed, setFailed] = useState(false)
  const [busyName, setBusyName] = useState(null)
  const [expanded, setExpanded] = useState({})

  const refresh = useCallback(async () => {
    setFailed(false)
    try {
      setSkills(await listSkills())
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    if (!currentUser) return undefined
    let cancelled = false
    listSkills()
      .then(data => { if (!cancelled) setSkills(data) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [currentUser])

  const remove = async skill => {
    setBusyName(skill.name)
    try {
      await removeSkill(skill.name)
      showToast?.(`${skill.title} kaldırıldı.`, 'success')
      await refresh()
    } catch (error) {
      showToast?.(error.message || 'Skill kaldırılamadı.', 'error')
    } finally {
      setBusyName(null)
    }
  }

  const row = skill => (
    <div key={skill.name} className="km-row skill-row">
      <div className="km-row-text">
        <span className="skill-head">
          <span className="km-row-label">{skill.title}</span>
          {(skill.where || []).map(place => <span key={place} className="skill-where">{place}</span>)}
        </span>
        <span className="km-row-desc skill-desc" title={skill.description}>{skill.description}</span>
        {skill.installed && skill.sourceUrl && <span className="km-row-desc">Kaynak: {skillSourceLabel(skill.sourceUrl)}</span>}
      </div>
      {skill.installed && (
        <button type="button" className="connector-btn disconnect" onClick={() => remove(skill)} disabled={busyName === skill.name} title="Skill'i kaldır">
          {busyName === skill.name ? <><IconLoading size={14} className="spin" /> Kaldırılıyor</> : <><IconDelete size={14} /> Kaldır</>}
        </button>
      )}
    </div>
  )

  const renderGroup = (key, title, items) => {
    if (!items.length) return null
    const isExpanded = Boolean(expanded[key])
    const hasMore = items.length > VISIBLE_LIMIT
    const visible = hasMore && !isExpanded ? items.slice(0, VISIBLE_LIMIT) : items
    return (
      <div key={key} className="skills-group">
        <h4 className="skills-subheading">{title}</h4>
        <SettingsGroup>{visible.map(row)}</SettingsGroup>
        {hasMore && (
          <button
            type="button"
            className="skills-more-btn"
            onClick={() => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
          >
            {isExpanded ? 'Daha az göster' : `Tümünü göster (${items.length})`}
          </button>
        )}
      </div>
    )
  }

  const groups = groupSkills(skills || [])
  return (
    <div className="settings-section">
      <h3>Skill'ler</h3>
      <p className="settings-hint">Skill'ler belirli işler için hazır talimatlardır. Bir şeye ihtiyaç duyduğunda KocaMind uygun olanı kendisi seçer; senin bir şey açman gerekmez. Sohbette "şu adresteki skill'i kur" dersen internetten indirip senin onayınla hesabına kurar; yalnızca metin talimatlar alınır, kod çalıştırılmaz.</p>
      {!currentUser ? (
        <p className="settings-hint">Skill'leri görmek için giriş yap.</p>
      ) : failed && !skills ? (
        <SettingsGroup>
          <div className="connector-row">
            <div className="connector-info"><span className="connector-name">Skill'ler yüklenemedi</span><span className="connector-desc">İnternet bağlantını kontrol et.</span></div>
            <button type="button" className="connector-btn" onClick={refresh}><IconRetry size={14} /> Tekrar dene</button>
          </div>
        </SettingsGroup>
      ) : !skills ? (
        <SkeletonRows count={4} />
      ) : (
        <>
          {renderGroup('installed', "Kurduğun skill'ler", groups.installed)}
          {renderGroup('always', 'Her zaman açık', groups.always)}
          {renderGroup('onDemand', 'Gerektiğinde yüklenir', groups.onDemand)}
        </>
      )}
    </div>
  );
}
