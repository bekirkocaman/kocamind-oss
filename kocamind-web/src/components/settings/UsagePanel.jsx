import { useEffect, useState } from "react";
import { parseDailyUsage, resetCountdown, usageLevel, usagePercent } from "../../lib/usage";
import { SettingsGroup } from "./Fields";

// Günlük limit çubuğu, yüzde ve yenilenmeye kalan süre.
function DailyLimit({ dailyUsage }) {
  const [countdown, setCountdown] = useState(() => resetCountdown())
  useEffect(() => {
    const timer = setInterval(() => setCountdown(resetCountdown()), 1000)
    return () => clearInterval(timer)
  }, [])

  if (dailyUsage === undefined) {
    return (
      <div className="usage-summary" aria-busy="true">
        <div className="usage-summary-head"><span>Günlük limit</span><span className="km-skeleton" style={{ width: 90 }} /></div>
        <span className="km-skeleton" style={{ width: '100%', height: 6, margin: '8px 0' }} />
      </div>
    )
  }
  const parsed = dailyUsage && parseDailyUsage(dailyUsage)
  if (!parsed) {
    return (
      <div className="usage-summary">
        <div className="usage-summary-head"><span>Günlük limit</span></div>
        <span className="usage-summary-note">Kullanım bilgisi alınamadı</span>
      </div>
    )
  }
  const pct = usagePercent(parsed)
  return (
    <div className="usage-summary">
      <div className="usage-summary-head">
        <span>Günlük limit</span>
        <span className="usage-summary-val settings-tabular">%{pct} kullanıldı</span>
      </div>
      <div className={`usage-bar level-${usageLevel(pct)}`} role="progressbar" aria-label="Günlük limit kullanımı" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="usage-summary-note settings-tabular">{pct >= 100 ? 'Limit doldu' : `Kalan %${100 - pct}`} · Yenilenmeye {countdown}</span>
    </div>
  )
}

export default function UsagePanel({ currentUser, dailyUsage, usageStats }) {
  return (
    <>
      {currentUser && (
        <div className="settings-section">
          <DailyLimit dailyUsage={dailyUsage} />
          <p className="settings-hint">Günlük limit her gün gece yarısı (UTC) yenilenir. Plus üyelikte limit daha yüksektir.</p>
        </div>
      )}

      {currentUser && dailyUsage && (
        <div className="settings-section">
          <h4>Bugünkü ayrıntı</h4>
          <SettingsGroup>
            {[
              ['chat', 'Mesaj'], ['image', 'Görsel'], ['video', 'Video'], ['code', 'Kod'],
            ].map(([key, label]) => {
              const used = Number(dailyUsage.usage?.[key] || 0)
              const limit = Number(dailyUsage.limits?.[key] || 0)
              const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
              return (
                <div className="km-row usage-metric-row" key={key}>
                  <div className="usage-metric-top">
                    <span className="km-row-label">{label}</span>
                    <span className="km-row-value settings-tabular">{used}/{limit || '—'}</span>
                  </div>
                  {limit > 0 && (
                    <div className={`usage-bar thin level-${usageLevel(pct)}`}>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              )
            })}
          </SettingsGroup>
        </div>
      )}

      <div className="settings-section">
        <h4>Kullanım istatistikleri</h4>
        <SettingsGroup>
          <div className="km-row">
            <span className="km-row-label">Toplam mesaj</span>
            <span className="km-row-value settings-tabular">{usageStats.totalMessages || '—'}</span>
          </div>
          <div className="km-row">
            <span className="km-row-label">Aktif gün</span>
            <span className="km-row-value settings-tabular">{usageStats.activeDays || '—'}</span>
          </div>
          <div className="km-row">
            <span className="km-row-label">Haftalık ortalama</span>
            <span className="km-row-value settings-tabular">{usageStats.weeklyAvg || '—'}</span>
          </div>
          <div className="km-row">
            <span className="km-row-label">Aylık ortalama</span>
            <span className="km-row-value settings-tabular">{usageStats.monthlyAvg || '—'}</span>
          </div>
        </SettingsGroup>
      </div>

      <div className="settings-section">
        <h4>En çok konuşulan konular</h4>
        <div className="topic-list">
          {usageStats.topTopics.map((topic, i) => (
            <div key={topic} className="topic-row">
              <span className="topic-rank settings-tabular">#{i + 1}</span>
              <span className="topic-name">{topic}</span>
              <div className="topic-bar">
                <div className="topic-bar-fill" style={{ width: `${100 - i * 18}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h4>En aktif saatler</h4>
        <SettingsGroup>
          {usageStats.peakHours.map((hour, i) => (
            <div key={hour} className="km-row">
              <span className="km-row-label settings-tabular">{hour}</span>
              <span className="km-row-value">{i === 0 ? 'En aktif' : i === 1 ? '2. sırada' : '3. sırada'}</span>
            </div>
          ))}
        </SettingsGroup>
      </div>
    </>
  );
}
