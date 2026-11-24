import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import 'katex/dist/katex.min.css'
import { useEffect, useRef, useState } from "react";
import {
  IconDislike,
  IconDownload,
  IconEdit,
  IconJumpToLatest,
  IconLike,
  IconRegenerate,
  IconShare,
  IconVolume,
} from "../icons.jsx";
import { LogoMark } from "./LogoMark";
import { CopyButton } from "./CopyButton";
import { CodeBlock } from "./CodeBlock";
import { AgentSteps, AgentApprovalCard } from "./AgentStatus";
import ThinkingPanel from "./ThinkingPanel";
import { enhanceArtifactMarkdown, cleanToolResultText, activityLabel } from "../../lib/chatText";
import { isAllowedImageSrc, blockedImageHref } from "../../lib/imagePolicy";

function MarkdownImage({ src, alt }) {
  if (isAllowedImageSrc(src)) return <img src={src} alt={alt || ''} loading="lazy" referrerPolicy="no-referrer" />
  const href = blockedImageHref(src)
  const label = `Dış resim engellendi${alt ? `: ${alt}` : ''}`
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer">{label}</a>
    : <span>{label}</span>
}

const markdownComponents = {
  code: CodeBlock,
  a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  img: MarkdownImage,
}

export default function MessageList({
  messages,
  isLoading,
  isStreaming,
  agentStatus,
  editingMsgIdx,
  editText,
  onEditTextChange,
  onEditStart,
  onEditSend,
  onEditCancel,
  onApprovalDecision,
  onCheckVideo,
  getFeedback,
  onFeedback,
  onShare,
  onTTS,
  speakingMsgIdx,
  onRegenerate,
  messagesEndRef,
}) {
  const areaRef = useRef(null)
  const followRef = useRef(true)
  const [nearBottom, setNearBottom] = useState(true)
  const firstId = messages[0]?.id ?? messages[0]?.content
  // Yalnız ekran açıldıktan sonra eklenen mesajlar süzülerek gelir (açılan eski sohbet değil).
  const [baseline, setBaseline] = useState({ key: firstId, count: messages.length })
  if (baseline.key !== firstId) setBaseline({ key: firstId, count: messages.length })
  const enterFrom = baseline.key === firstId ? baseline.count : messages.length

  useEffect(() => {
    const area = areaRef.current
    if (!area) return undefined
    const update = () => {
      const near = area.scrollHeight - area.scrollTop - area.clientHeight <= 360
      followRef.current = near
      setNearBottom(near)
    }
    area.addEventListener('scroll', update, { passive: true })
    return () => area.removeEventListener('scroll', update)
  }, [])

  // Başka sohbet açılınca sonundan başlanır.
  useEffect(() => { followRef.current = true }, [firstId])

  // Kullanıcı sona yakınken yeni mesajlar ve akan metin takip edilir; yukarı kaydırdıysa yerinde kalır.
  useEffect(() => {
    const area = areaRef.current
    if (area && followRef.current) area.scrollTop = area.scrollHeight
  }, [messages, isLoading])

  const scrollToEnd = () => {
    followRef.current = true
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }

  return (
    <div className="chat-area" ref={areaRef}>
      <div className="messages-container">
        {messages.filter(msg => !(msg.role === 'ai' && !msg.content && !msg.thinking && !msg.agentRunning && !(msg.agentSteps?.length) && isLoading)).map((msg, idx) => (
          <div key={idx} className={`message-row ${msg.role} ${idx >= enterFrom ? 'enter' : ''}`}>
            <div className="message-bubble">
              {msg.role === 'user' ? (
                editingMsgIdx === idx ? (
                  <div className="edit-container">
                    <textarea className="edit-textarea" value={editText}
                      onChange={(e) => onEditTextChange(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEditSend() } }} />
                    <div className="edit-actions">
                      <button className="edit-save-btn" onClick={onEditSend}>Gönder</button>
                      <button className="edit-cancel-btn" onClick={onEditCancel}>İptal</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {msg.imageUrl && <img src={msg.imageUrl} alt="Yüklenen görsel" className="msg-image-preview" />}
                    {msg.content}
                  </>
                )
              ) : (
                <div className="markdown-body">
                  {((msg.thinkingActive && isLoading && !msg.content) || msg.thinking) && (
                    <div className="thinking-row">
                      {msg.thinkingActive && isLoading && !msg.content && <div className="thinking-mark"><LogoMark size={24} state="think" /></div>}
                      {msg.thinking && (
                        <ThinkingPanel
                          active={Boolean(msg.thinkingActive && isLoading)}
                          thinking={msg.thinking}
                          thinkingMs={msg.thinkingMs}
                          startedAt={msg.thinkingStartedAt}
                        />
                      )}
                    </div>
                  )}
                  {msg.answeredBy?.fallbackFromLabel && (
                    <div className="model-fallback-note">
                      {msg.answeredBy.fallbackFromLabel} şu an dolu olduğu için bu cevabı {msg.answeredBy.label} verdi.
                    </div>
                  )}
                  {(msg.agentRunning || msg.agentSteps?.length > 0) && (
                    <AgentSteps steps={msg.agentSteps || []} running={!!msg.agentRunning} status={agentStatus} />
                  )}
                  <AgentApprovalCard approval={msg.agentApproval} onDecision={(approved) => onApprovalDecision(msg.agentApproval, approved)} />
                  {msg.generatedImage && (
                    <div className="generated-media-card">
                      <img src={msg.generatedImage} alt={msg.mediaPrompt || 'KocaMind tarafından oluşturulan fotoğraf'} className="generated-media-image" />
                      <a className="generated-media-download" href={msg.generatedImage} download={`kocamind-gorsel-${idx + 1}.png`}>
                        <IconDownload size={14} /> İndir
                      </a>
                    </div>
                  )}
                  {msg.generatedVideo && (
                    <div className="generated-media-card">
                      <video src={msg.generatedVideo} controls playsInline preload="metadata" className={`generated-media-video ratio-${msg.mediaAspectRatio?.replace(':', '-') || '16-9'}`}>
                        Tarayıcın video oynatmayı desteklemiyor.
                      </video>
                      <a className="generated-media-download" href={msg.generatedVideo} download={`kocamind-video-${idx + 1}.mp4`}>
                        <IconDownload size={14} /> İndir
                      </a>
                    </div>
                  )}
                  {msg.mediaJobId && !msg.generatedVideo && (
                    <div className="generated-media-pending">
                      <span className="media-wait-dots" aria-hidden="true"><i /><i /><i /></span>
                      <span>{msg.mediaStatus === 'processing' ? 'Veo videoyu hazırlıyor' : 'Video arka planda hazırlanıyor'}</span>
                      {!isLoading && <button type="button" onClick={() => onCheckVideo(idx, msg)}>Kontrol et</button>}
                    </div>
                  )}
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={markdownComponents}
                  >{enhanceArtifactMarkdown(cleanToolResultText(msg.content))}</ReactMarkdown>
                  {isStreaming && idx === messages.length - 1 && Boolean(msg.content) && <span className="streaming-cursor" aria-hidden="true">▍</span>}
                </div>
              )}

              <div className="message-actions">
                {msg.role === 'user' && editingMsgIdx !== idx && (
                  <button className="action-btn action-btn-label" onClick={() => onEditStart(idx)} aria-label="Mesajı düzenle">
                    <IconEdit size={13} /> Düzenle
                  </button>
                )}
                {msg.role === 'ai' && msg.content && (
                  <>
                    <CopyButton text={msg.content} />
                    <button
                      className={`action-btn ${getFeedback(idx) === 'up' ? 'feedback-active-up' : ''}`}
                      onClick={() => onFeedback(idx, 'up')}
                      title="Beğen"
                      aria-pressed={getFeedback(idx) === 'up'}
                    >
                      <IconLike size={14} />
                    </button>
                    <button
                      className={`action-btn ${getFeedback(idx) === 'down' ? 'feedback-active-down' : ''}`}
                      onClick={() => onFeedback(idx, 'down')}
                      title="Beğenme"
                      aria-pressed={getFeedback(idx) === 'down'}
                    >
                      <IconDislike size={14} />
                    </button>
                    <button className="action-btn" onClick={() => onShare(msg.content)} title="Paylaş">
                      <IconShare size={14} />
                    </button>
                    <button
                      className={`action-btn ${speakingMsgIdx === idx ? 'speaking' : ''}`}
                      onClick={() => onTTS(idx, msg.content)}
                      title={speakingMsgIdx === idx ? 'Durdur' : 'Sesli Oku'}
                    >
                      <IconVolume size={14} />
                    </button>
                    {idx === messages.length - 1 && !isLoading && !msg.generatedImage && !msg.generatedVideo && !msg.mediaJobId && (
                      <button className="action-btn" onClick={onRegenerate} title="Yeniden Üret">
                        <IconRegenerate size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {isLoading && !(
          messages.at(-1)?.role === 'ai'
          && (messages.at(-1)?.content?.trim() || messages.at(-1)?.thinking || messages.at(-1)?.agentSteps?.length || messages.at(-1)?.agentRunning)
        ) && (
          <div className="message-row ai enter">
            <div className="message-bubble">
              <div className="thinking-row">
                <div className="thinking-mark"><LogoMark size={24} state="think" /></div>
                <ThinkingPanel active label={agentStatus && !/hazırlıyorum$/.test(activityLabel(agentStatus)) ? activityLabel(agentStatus) : 'Düşünüyor'} />
              </div>
            </div>
          </div>
        )}
        {!isLoading && <p className="chat-disclaimer">KocaMind bir yapay zekâdır ve hata yapabilir.</p>}
        <div ref={messagesEndRef} />
      </div>
      {!nearBottom && (
        <button type="button" className="scroll-bottom-btn" onClick={scrollToEnd} aria-label="En alta kaydır">
          <IconJumpToLatest size={20} />
        </button>
      )}
    </div>
  )
}
