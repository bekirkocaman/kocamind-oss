import { useEffect, useState } from "react";
import { isQuotaExhausted, quotaExhaustedText, quotaNotice } from "../../lib/usage";

// Mesaj kutusunun üstündeki ince satır: hak azalınca uyarı, bitince saniyede bir güncellenen geri sayım.
export default function QuotaNotice({ quota }) {
  const ranOut = quota?.remaining === 0
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!ranOut) return undefined
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [ranOut])

  // Gece yarısı geçince hak yenilenir; geri sayım başa sarmasın.
  const exhausted = isQuotaExhausted(quota, now)

  const text = exhausted ? quotaExhaustedText(now) : ranOut ? null : quotaNotice(quota)
  if (!text) return null
  return (
    <p className={`quota-notice${exhausted ? " quota-notice--out" : ""}`} role="status">
      {text}
    </p>
  )
}
