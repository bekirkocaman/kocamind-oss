import { useEffect, useState } from "react";
import {
  IconAdd,
  IconAgent,
  IconClose,
  IconDeepResearch,
  IconImageUpload,
  IconMic,
  IconSendMessage,
} from "../icons.jsx";

// Klon düzeni: üstte metin, altta "+" ve model hapı; sağda duruma göre mikrofon, gönder ya da durdur.
export default function ChatInput({
  isAttachmentMenuOpen,
  onToggleAttachmentMenu,
  onPickFile,
  fileInputRef,
  onFileSelected,
  showDeepResearch,
  hasPlusAccess,
  isDeepResearchMode,
  onDeepResearch,
  assistantType,
  onAgentMode,
  onCloseMode,
  isRecording,
  onVoiceToggle,
  textareaRef,
  onInput,
  onKeyDown,
  isLoading,
  onStop,
  onSend,
  hasMessages,
  modelSlot,
  notice,
}) {
  const [hasText, setHasText] = useState(false)

  useEffect(() => {
    setHasText(Boolean(textareaRef.current?.value.trim()))
  }, [isLoading, textareaRef])

  const mode = assistantType === 'agent' ? 'agent' : isDeepResearchMode ? 'research' : null
  const placeholder = mode === 'agent'
    ? "Agent'a bir görev ver…"
    : mode === 'research'
      ? 'Derinlemesine araştırılacak konuyu yaz…'
      : hasMessages ? "KocaMind'e yanıt ver…" : 'KocaMind ile sohbet et…'

  return (
    <div className="input-area">
      {notice}
      {mode && (
        <div className="composer-mode">
          {mode === 'agent' ? <IconAgent size={14} /> : <IconDeepResearch size={14} />}
          <span>{mode === 'agent' ? 'Agent modu' : 'Derin Araştırma'}</span>
          <button type="button" className="composer-mode-close" onClick={onCloseMode} aria-label="Modu kapat">
            <IconClose size={15} />
          </button>
        </div>
      )}
      <div className="input-container composer">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={placeholder}
          onInput={(e) => { setHasText(Boolean(e.target.value.trim())); onInput?.(e) }}
          onKeyDown={onKeyDown}
          rows={1}
          aria-label="Mesajını yaz"
        />

        <div className="composer-row">
          <div className="attachment-wrapper">
            <button
              className={`composer-icon-btn plus-btn ${isAttachmentMenuOpen ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleAttachmentMenu() }}
              title="Ekle"
              aria-label="Araç menüsünü aç"
            >
              <IconAdd size={20} />
            </button>

            {isAttachmentMenuOpen && (
              <div className="attachment-menu-container">
                <button className="att-menu-item" onClick={onPickFile}>
                  <IconImageUpload size={16} className="att-icon" />
                  <span>Fotoğraf Yükle</span>
                </button>
                {showDeepResearch && <button className="att-menu-item" onClick={onDeepResearch}>
                  <IconDeepResearch size={16} className="att-icon" />
                  <span>Derin Araştırma</span>
                  <span className="att-badge">{hasPlusAccess && isDeepResearchMode ? 'Hazır' : 'Plus'}</span>
                </button>}
                <button className="att-menu-item" onClick={onAgentMode}>
                  <IconAgent size={16} className="att-icon" />
                  <span>Agent Modu</span>
                  {assistantType === 'agent' && <span className="att-badge">Hazır</span>}
                </button>
              </div>
            )}
          </div>

          <input type="file" ref={fileInputRef} onChange={onFileSelected} accept="image/*" style={{ display: 'none' }} />

          {modelSlot}

          <span className="composer-spacer" />

          {isLoading ? (
            <button className="stop-button" onClick={onStop} title="Durdur" aria-label="Yanıtı durdur">
              <span className="stop-square" />
            </button>
          ) : hasText && !isRecording ? (
            <button className="send-button" onClick={onSend} aria-label="Mesajı gönder">
              <IconSendMessage size={20} />
            </button>
          ) : (
            <button
              className={`composer-icon-btn voice-btn ${isRecording ? 'recording' : ''}`}
              onClick={onVoiceToggle}
              title={isRecording ? 'Kaydı bitir' : 'Sesli mesaj'}
              aria-label={isRecording ? 'Ses kaydını durdur' : 'Sesli mesaj kaydet'}
            >
              <IconMic size={19} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
