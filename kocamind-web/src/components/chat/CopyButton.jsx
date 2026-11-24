import { useState } from "react";
import { IconCheck, IconCopy } from "../icons.jsx";

export function CopyButton({ text, className = '' }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button className={`copy-btn ${className}`} onClick={handleCopy} title="Kopyala">
      {copied ? <><IconCheck size={14} /> Kopyalandı</> : <><IconCopy size={14} /> Kopyala</>}
    </button>
  )
}
