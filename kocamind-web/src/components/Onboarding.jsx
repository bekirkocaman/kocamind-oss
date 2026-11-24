import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconAgent,
  IconBack,
  IconCapabilities,
  IconChatText,
  IconDocumentAnswers,
  IconImageCreate,
  IconMemory,
  IconMic,
  IconModelTools,
  IconModels,
  IconNext,
  IconPromptExample,
  IconVerifiedProtection,
} from './icons.jsx'
import { SUGGESTIONS } from '../lib/suggestions'
import './Onboarding.css'

const STARTER_PROMPTS = [
  SUGGESTIONS[0],
  SUGGESTIONS[1],
  {
    id: 'sadelestir',
    label: 'Bir konuyu sadeleştir',
    prompt: 'Şu konuyu sade Türkçe ile maddeler hâlinde açıkla: ',
    needsImage: false,
  },
]

const STEPS = [
  {
    id: 'welcome',
    title: "KocaMind'e hoş geldin",
    subtitle: 'Günlük Türkçe yapay zeka asistanın — hepsi tek yerde.',
    icon: null,
    items: [
      {
        icon: IconChatText,
        title: 'Doğal Türkçe sohbet ve yazı',
        desc: 'Dilekçe, resmi e-posta, özet ve adım adım açıklamaları hızlıca hazırlar.',
      },
      {
        icon: IconMic,
        title: 'Fotoğraf, belge ve ses desteği',
        desc: 'Fotoğraf yükleyip soru sorabilir ya da sesli mesajla yazabilirsin. Doküman özelliği etkinse belgelerinden yanıt alabilirsin.',
      },
      {
        icon: IconImageCreate,
        title: 'Görsel oluşturma ve güncel arama',
        desc: 'Görsel oluşturma etkinse tarif ettiğin görselleri üretir. Web araması etkinse güncel bilgileri arar.',
      },
    ],
  },
  {
    id: 'models',
    title: 'Modeller ve araçlar',
    subtitle: 'İşine uygun modeli ve modu sohbetten çıkmadan seç.',
    icon: IconModelTools,
    items: [
      {
        icon: IconModels,
        title: 'İstediğin modeli seç',
        desc: 'Mesaj kutusunun altındaki model seçiciden farklı yapay zeka modelleri arasında anında geçiş yapabilirsin.',
      },
      {
        icon: IconAgent,
        title: 'Agent Modu ve Derin Araştırma',
        desc: 'Mesaj kutusundaki + menüsünden adım adım görevler için Agent Modu’nu, Plus ile kapsamlı raporlar için Derin Araştırma’yı açabilirsin.',
      },
      {
        icon: IconCapabilities,
        title: 'Yetenek kontrolü',
        desc: 'Web Arama, Görsel Oluşturma ve Dokümanlardan Yanıtla (RAG) seçeneklerini Ayarlar > Özellikler sekmesinden yönetebilirsin.',
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Hafıza, gizlilik ve dokümanlar',
    subtitle: 'Neyi hatırlayacağına ve hangi dosyaları kullanacağına sen karar verirsin.',
    icon: IconVerifiedProtection,
    items: [
      {
        icon: IconMemory,
        title: 'Sana göre şekillenen hafıza',
        desc: 'Sohbetlerde paylaştığın adın, işin ve tercihlerin gibi önemli bilgileri hatırlayıp yanıtlarını buna göre uyarlar.',
      },
      {
        icon: IconVerifiedProtection,
        title: 'İstediğin an gör, sil ya da kapat',
        desc: 'Ayarlar > Hafıza sekmesinden hatırlananları silebilir; Ayarlar > Gizlilik sekmesinden hafızayı, otomatik kaydetmeyi ve veri saklama süresini kapatıp değiştirebilirsin.',
      },
      {
        icon: IconDocumentAnswers,
        title: 'Kendi dokümanlarından yanıt al',
        desc: 'Dokümanlardan Yanıtla (RAG) etkinse Ayarlar > Dokümanlar sekmesinden yüklediğin metin dosyalarını (.txt, .md, .csv, kod) sohbetlerde kaynak olarak kullanabilirsin.',
      },
    ],
  },
]

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Onboarding({ onComplete, onSkip, onPickPrompt }) {
  const [stepIndex, setStepIndex] = useState(0)
  const dialogRef = useRef(null)
  const pickedPromptRef = useRef(false)
  const step = STEPS[stepIndex]
  const isFirst = stepIndex === 0
  const isLast = stepIndex === STEPS.length - 1

  useLayoutEffect(() => {
    const previousFocus = document.activeElement
    return () => {
      if (!pickedPromptRef.current && previousFocus instanceof HTMLElement) {
        requestAnimationFrame(() => {
          if (previousFocus.isConnected && !previousFocus.closest('[inert]') && document.activeElement === document.body) {
            previousFocus.focus()
          }
        })
      }
    }
  }, [])

  useLayoutEffect(() => {
    dialogRef.current?.focus()
  }, [stepIndex])

  useEffect(() => {
    const onFocusIn = (e) => {
      const dialog = dialogRef.current
      if (dialog && !dialog.contains(e.target)) dialog.focus()
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onSkip()
        return
      }
      const dialog = dialogRef.current
      if (e.key !== 'Tab' || !dialog) return
      const focusable = dialog.querySelectorAll(FOCUSABLE_SELECTOR)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const outsideControls = !dialog.contains(active) || active === dialog
      if (!first || outsideControls || active === (e.shiftKey ? first : last)) {
        e.preventDefault()
        const target = (e.shiftKey ? last : first) ?? dialog
        target.focus()
      }
    }
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onSkip])

  const handlePromptClick = (suggestion) => {
    pickedPromptRef.current = true
    onPickPrompt?.(suggestion)
  }

  return (
    <div className="km-dialog-overlay" onClick={onSkip}>
      <div
        ref={dialogRef}
        className="km-onboarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="km-onboarding-title"
        aria-describedby="km-onboarding-subtitle"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="km-onboarding-top">
          <div className="km-onboarding-progress" aria-label={`Adım ${stepIndex + 1} / ${STEPS.length}`}>
            <span className="km-onboarding-step-label">
              {stepIndex + 1} / {STEPS.length}
            </span>
          </div>

          <button type="button" className="km-onboarding-skip" onClick={onSkip}>
            Geç
          </button>
        </div>

        <div className="km-onboarding-hero">
          <div className="km-onboarding-headings">
            <h2 id="km-onboarding-title" className="km-onboarding-title">
              {step.title}
            </h2>
            <p id="km-onboarding-subtitle" className="km-onboarding-subtitle">
              {step.subtitle}
            </p>
          </div>
        </div>

        <ul className="km-onboarding-list">
          {step.items.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.title} className="km-onboarding-item">
                <span className="km-onboarding-item-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <div className="km-onboarding-item-body">
                  <strong className="km-onboarding-item-title">{item.title}</strong>
                  <p className="km-onboarding-item-desc">{item.desc}</p>
                </div>
              </li>
            )
          })}
        </ul>

        {isLast && (
          <div className="km-onboarding-prompts">
            <p className="km-onboarding-prompts-label">Örnek bir soruyla başla:</p>
            <div className="km-onboarding-prompt-list">
              {STARTER_PROMPTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="km-onboarding-prompt-btn"
                  onClick={() => handlePromptClick(item)}
                >
                  <IconPromptExample size={14} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="km-onboarding-footer">
          {!isFirst && (
            <button
              type="button"
              className="km-onboarding-nav-btn"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              <IconBack size={16} aria-hidden="true" />
              <span>Geri</span>
            </button>
          )}

          {isLast ? (
            <button
              type="button"
              className="km-onboarding-nav-btn primary"
              onClick={onComplete}
            >
              <span>Başlayalım</span>
              <IconNext size={16} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="km-onboarding-nav-btn primary"
              onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
            >
              <span>İleri</span>
              <IconNext size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
