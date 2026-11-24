import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PwaAutoUpdate() {
  // Yeni sürümü arka planda hazırla; açık sayfayı zorla yeniden yükleme.
  // Böylece kullanıcı çalışırken veya F5 sonrasında ikinci bir tam sayfa geçişi görmez.
  useRegisterSW({ immediate: true })

  return null
}
