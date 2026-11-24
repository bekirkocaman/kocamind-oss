// Ayarlar > Skill'ler: yerleşik skill'ler ve kullanıcının internetten kurdurduğu skill'ler.
// Talimat gövdesi sunucuda kalır; burada yalnızca görünen bilgiler var.
import { API, authFetch } from './api'

async function readJson(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Sunucu hatası (${response.status})`)
  return data
}

export async function listSkills() {
  const { skills } = await readJson(await authFetch(API.skills))
  return Array.isArray(skills) ? skills : []
}

export async function removeSkill(name) {
  return readJson(await authFetch(API.skill(name), { method: 'DELETE' }))
}

// Sayfadaki gruplar: kurduğun skill'ler, her zaman açık olanlar, gerektiğinde yüklenenler.
export function groupSkills(skills = []) {
  return {
    installed: skills.filter(skill => skill.installed),
    always: skills.filter(skill => !skill.installed && skill.alwaysOn),
    onDemand: skills.filter(skill => !skill.installed && !skill.alwaysOn),
  }
}

// Kaynak adresini kısa gösterir: "github.com/sahip/repo".
export function skillSourceLabel(url) {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    const parts = parsed.pathname.split('/').filter(Boolean).slice(0, 2)
    return [host === 'raw.githubusercontent.com' ? 'github.com' : host, ...parts].join('/')
  } catch {
    return ''
  }
}
