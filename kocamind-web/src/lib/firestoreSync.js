// ═══ KocaMind Firestore Senkronizasyonu ═══
// Giriş yapan kullanıcının sohbetleri + özel asistanları buluta kaydedilir.
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc, runTransaction, onSnapshot,
} from 'firebase/firestore'
import { db } from './firebase'
import { createChatSync } from './chatSync'

const chatsCol = (uid) => collection(db, 'users', uid, 'chats')
const userDoc = (uid) => doc(db, 'users', uid)

// ─── Sohbetler ───
// Okuma, işlemle yazma, silme ve dinleme; birleştirme kuralları chatSync.js / chatMerge.js'te.

const chatDoc = (uid, chatId) => doc(db, 'users', uid, 'chats', String(chatId))

export const firestoreChatApi = {
  async list(uid) {
    const snap = await getDocs(chatsCol(uid))
    return snap.docs.map(d => [d.id, d.data()])
  },
  async delete(uid, chatId) {
    await deleteDoc(chatDoc(uid, chatId))
  },
  // Belge işlem içinde okunur ve birleşik hâl yazılır; arada başka cihaz yazarsa işlem yeniden denenir.
  async transact(uid, chatId, update) {
    const ref = chatDoc(uid, chatId)
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      const next = update(snap.exists() ? snap.data() : null)
      if (next) tx.set(ref, next)
    })
  },
  listen(uid, onDocs) {
    return onSnapshot(chatsCol(uid), { includeMetadataChanges: true }, (snap) => {
      // Önbellekteki eski hâl silinmiş sohbeti geri getirmesin: yalnız sunucu hâli işlenir.
      if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) return
      onDocs(snap.docs.map(d => [d.id, d.data()]))
    }, (error) => console.error('Sohbet dinleyicisi hata verdi:', error))
  },
}

export const chatSync = createChatSync({ api: firestoreChatApi })

export async function deleteAllChatsFromCloud(uid) {
  const snap = await getDocs(chatsCol(uid))
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
}

// ─── Özel Asistanlar (kullanıcı dokümanında saklanır) ───

export async function fetchCloudAssistants(uid) {
  const snap = await getDoc(userDoc(uid))
  if (!snap.exists()) return null
  return snap.data().customAssistants || null
}

export async function saveAssistantsToCloud(uid, assistants) {
  await setDoc(userDoc(uid), { customAssistants: assistants }, { merge: true })
}

