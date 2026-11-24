// Kullanıcıya göre yanıt tarzı: geri bildirimden yanıt uzunluğu tercihini öğrenir.
//
// user_style/{uid}
//   { uid, length: 'kisa'|'detayli'|null, enabled: boolean, basedOn: number, updatedAt }
//
// Kullanıcı uzun cevapları sürekli beğenmiyor ama kısaları beğeniyorsa "kısa" öğrenilir
// (tersi de geçerli). Kullanıcı kapatabilir (enabled: false); o zaman gece işi dokunmaz
// ve sohbete kural eklenmez. Hesap silmede `user_style` koleksiyonu uid ile temizlenir.

const STYLE_CACHE_MS = 10 * 60 * 1000;
const MIN_EACH = 2;
const RATIO = 1.6;
const MIN_LONG = 800;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// entries: [{ type: 'up'|'down', answerLength }]
function learnLength(entries) {
  const ups = entries.filter(entry => entry.type === 'up').map(entry => Number(entry.answerLength) || 0);
  const downs = entries.filter(entry => entry.type === 'down').map(entry => Number(entry.answerLength) || 0);
  if (ups.length < MIN_EACH || downs.length < MIN_EACH) return null;
  const up = median(ups);
  const down = median(downs);
  if (down >= MIN_LONG && down > up * RATIO) return 'kisa';
  if (up >= MIN_LONG && up > down * RATIO) return 'detayli';
  return null;
}

function styleRule(style) {
  if (!style || style.enabled === false) return '';
  if (style.length === 'kisa') return 'Bu kullanıcı geçmiş geri bildirimlerine göre kısa ve öz cevapları tercih ediyor. Gerekmedikçe uzatma; önce doğrudan cevabı ver.';
  if (style.length === 'detayli') return 'Bu kullanıcı geçmiş geri bildirimlerine göre ayrıntılı cevapları tercih ediyor. Adımları ve gerekçeleri açıkla.';
  return '';
}

function createUserStyle({ firestoreDb, now = () => Date.now() }) {
  const cache = new Map();
  const ref = uid => firestoreDb.collection('user_style').doc(uid);

  async function get(uid) {
    if (!uid) return null;
    const cached = cache.get(uid);
    if (cached && now() - cached.at < STYLE_CACHE_MS) return cached.style;
    try {
      const snapshot = await ref(uid).get();
      const style = snapshot.exists ? snapshot.data() : null;
      cache.set(uid, { at: now(), style });
      return style;
    } catch (error) {
      console.warn('Yanıt tarzı okunamadı:', error.message);
      return null;
    }
  }

  async function setEnabled(uid, enabled) {
    const current = (await ref(uid).get()).data() || {};
    const next = { ...current, uid, enabled: Boolean(enabled), updatedAt: new Date(now()).toISOString() };
    // Kapatınca öğrenilen tercih de unutulur.
    if (!enabled) { next.length = null; next.basedOn = 0; }
    await ref(uid).set(next);
    cache.delete(uid);
    return next;
  }

  // Gece işi: kullanıcının son geri bildirimlerinden tercihi yeniden hesaplar.
  async function relearn(uid, entries) {
    const snapshot = await ref(uid).get();
    const current = snapshot.exists ? snapshot.data() : null;
    if (current?.enabled === false) return current;
    const next = { uid, enabled: true, length: learnLength(entries), basedOn: entries.length, updatedAt: new Date(now()).toISOString() };
    await ref(uid).set(next);
    cache.delete(uid);
    return next;
  }

  return { get, setEnabled, relearn };
}

module.exports = { createUserStyle, learnLength, styleRule };
