import { useState, useEffect } from 'react'
import {
  IconAnalyzeProfile,
  IconBack,
  IconCalendar,
  IconLoading,
  IconMessages,
  IconPrevious,
  IconProfile,
  IconProfileInsights,
  IconSearch,
  IconView,
} from './icons.jsx'
import { authFetch, BACKEND_URL } from '../lib/api'
import './UserProfiler.css'

export default function UserProfiler({ onBack, showToast }) {
  const [profiles, setProfiles] = useState({})
  const [users, setUsers] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [analyzing, setAnalyzing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  async function loadAllProfiles() {
    try {
      const r = await authFetch(`${BACKEND_URL}/profiles`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Profiller alınamadı')
      setProfiles(d.profiles || {})
    } catch { /* backend kapalı */ }
  }

  async function loadAllUsers() {
    try {
      const response = await authFetch(`${BACKEND_URL}/admin/users`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Kullanıcılar alınamadı')
      setUsers(data.users || [])
    } catch (e) {
      console.error('Kullanıcılar alınamadı:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      loadAllProfiles()
      loadAllUsers()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  const handleAnalyze = async (user) => {
    setAnalyzing(user.uid)
    try {
      const res = await authFetch(`${BACKEND_URL}/profile/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: user.uid, messages: user.messages.slice(-300) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setProfiles(prev => ({ ...prev, [user.uid]: data.profile }))
      showToast(`${user.uid.slice(0, 8)}... analiz edildi`, 'success')
    } catch (e) {
      showToast('Analiz başarısız: ' + e.message, 'error')
    } finally {
      setAnalyzing(null)
    }
  }

  const filteredUsers = users.filter(u =>
    u.uid.toLowerCase().includes(search.toLowerCase())
  )

  if (selectedUser) {
    const profile = profiles[selectedUser.uid]
    return (
      <div className="up-dashboard">
        <div className="up-topbar">
          <button className="up-back-btn" onClick={() => setSelectedUser(null)}>
            <IconBack size={18} /> Geri
          </button>
          <h2>{selectedUser.uid.slice(0, 16)}...</h2>
          {!profile && (
            <button
              className="up-analyze-btn"
              onClick={() => handleAnalyze(selectedUser)}
              disabled={analyzing === selectedUser.uid}
            >
              {analyzing === selectedUser.uid ? 'Analiz ediliyor...' : 'Analiz Et'}
            </button>
          )}
        </div>

        <div className="up-detail">
          <div className="up-detail-cards">
            <div className="up-detail-card">
              <IconMessages size={18} />
              <strong>{selectedUser.messageCount}</strong>
              <span>Mesaj</span>
            </div>
            <div className="up-detail-card">
              <IconCalendar size={18} />
              <strong>{selectedUser.chatCount}</strong>
              <span>Sohbet</span>
            </div>
            <div className="up-detail-card">
              <IconView size={18} />
              <strong>{profile ? 'Var' : 'Yok'}</strong>
              <span>Profil</span>
            </div>
          </div>

          {profile ? (
            <div className="up-profile-text">
              {profile.analysis.split('\n').map((line, i) => {
                if (line.match(/^\d+\./) || line.startsWith('## ')) return <h2 key={i}>{line}</h2>
                if (line.startsWith('# ')) return <h3 key={i}>{line.replace('# ', '')}</h3>
                return <p key={i}>{line || <br />}</p>
              })}
              <p className="up-profile-date">
                Analiz tarihi: {new Date(profile.analyzedAt).toLocaleString('tr-TR')}
              </p>
            </div>
          ) : (
            <div className="up-no-profile">
              <IconProfileInsights size={48} />
              <h3>Henüz analiz edilmedi</h3>
              <p>Bu kullanıcı için AI profil analizi yapılmamış.</p>
              <button className="up-analyze-btn" onClick={() => handleAnalyze(selectedUser)} disabled={analyzing === selectedUser.uid}>
                {analyzing === selectedUser.uid ? 'Analiz ediliyor...' : 'Hemen Analiz Et'}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="up-dashboard">
      <div className="up-topbar">
        <button className="up-back-btn" onClick={onBack}>
          <IconPrevious size={18} /> Ana Sayfa
        </button>
        <h2>Kullanıcı Analizleri</h2>
        <span className="up-admin-badge">Admin</span>
      </div>

      <div className="up-search-row">
        <IconSearch size={16} />
        <input
          placeholder="Kullanıcı ID'si ile ara..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="up-loading">Yükleniyor...</div>
      ) : filteredUsers.length === 0 ? (
        <div className="up-empty-state">
          <IconProfile size={48} />
          <h3>Kullanıcı bulunamadı</h3>
          <p>Henüz sohbet eden kullanıcı yok veya aramanla eşleşen bulunamadı.</p>
        </div>
      ) : (
        <div className="up-user-grid">
          {filteredUsers.map(user => {
            const profile = profiles[user.uid]
            return (
              <div
                key={user.uid}
                className="up-user-card"
                onClick={() => setSelectedUser(user)}
              >
                <div className="up-user-card-top">
                  <div className="up-user-avatar">
                    <IconProfile size={20} />
                  </div>
                  <div className="up-user-card-info">
                    <span className="up-user-card-id">{user.uid.slice(0, 14)}...</span>
                    <span className="up-user-card-meta">
                      <IconMessages size={11} /> {user.messageCount} msg
                      <IconCalendar size={11} /> {user.chatCount} sohbet
                    </span>
                  </div>
                  {profile ? (
                    <span className="up-user-badge analyzed">Analizli</span>
                  ) : (
                    <button
                      className="up-user-badge"
                      onClick={e => { e.stopPropagation(); handleAnalyze(user) }}
                      disabled={analyzing === user.uid}
                    >
                      {analyzing === user.uid ? <IconLoading size={14} className="up-spin" /> : <IconAnalyzeProfile size={14} />}
                    </button>
                  )}
                </div>
                {profile && (
                  <div className="up-user-card-preview">
                    {profile.analysis.slice(0, 120)}...
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
