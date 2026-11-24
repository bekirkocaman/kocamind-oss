// "4 saniye düşündü" metni; en az 1 saniye gösterilir (Android thoughtForLabel).
export function thoughtForLabel(ms) {
  return `${Math.max(1, Math.round((Number(ms) || 0) / 1000))} saniye düşündü`
}

// /chat akışındaki düşünce parçası (DeepSeek reasoning_content ve OpenAI özetleri aynı alana yazılır).
export function reasoningChunk(event) {
  const chunk = event?.choices?.[0]?.delta?.reasoning_content
  return typeof chunk === 'string' ? chunk : ''
}
