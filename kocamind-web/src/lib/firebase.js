import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail, sendEmailVerification } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCXZA4rixnuuus280X8yzh339e-mln6X8M',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'kocamind.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'kocamind',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'kocamind.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '956051927831',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:956051927831:web:ec7667391770e08b643d52',
}

let app, db, auth

try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp()
  db = getFirestore(app)
  auth = getAuth(app)
  // Uçtan uca testler: Auth ve Firestore yerel emülatöre bağlanır (firebase.json).
  if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === '1') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
  }
} catch (error) {
  console.error('Firebase init error', error)
}

const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

const GOOGLE_REDIRECT_PURPOSE_KEY = 'kocamind_google_redirect_purpose'

export function shouldUseGoogleRedirect() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

export async function startGoogleRedirect(provider = googleProvider, purpose = 'login') {
  sessionStorage.setItem(GOOGLE_REDIRECT_PURPOSE_KEY, purpose)
  await signInWithRedirect(auth, provider)
}

export async function completeGoogleRedirect() {
  const purpose = sessionStorage.getItem(GOOGLE_REDIRECT_PURPOSE_KEY)
  try {
    const result = await getRedirectResult(auth)
    if (result || purpose) sessionStorage.removeItem(GOOGLE_REDIRECT_PURPOSE_KEY)
    return { result, purpose }
  } catch (error) {
    sessionStorage.removeItem(GOOGLE_REDIRECT_PURPOSE_KEY)
    throw error
  }
}

export { app, db, auth, googleProvider }
export {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  sendEmailVerification,
  GoogleAuthProvider
}
