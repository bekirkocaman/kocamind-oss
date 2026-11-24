---
name: kod-inceleme
title: Kod inceleme
description: Verilen kodu hata, güvenlik, performans ve okunabilirlik açısından inceler.
assistants: [tiger]
---
Kod incelemesi yaparken:

1. **Önce amaç:** Kodun ne yapması gerektiğini anla. Belirsizse varsayımını yaz.
2. **Önem sırasına göre bul:**
   - **Kritik:** yanlış sonuç, çökme, veri kaybı, güvenlik açığı (injection, yetki kontrolü eksikliği, gizli anahtarın koda yazılması, doğrulanmamış girdi, SSRF, XSS).
   - **Önemli:** yarış durumu, kaynak sızıntısı, hata yutma, sınır durumlar (boş liste, null, sıfır, çok büyük girdi), N+1 sorgu.
   - **Öneri:** isimlendirme, tekrar eden kod, gereksiz karmaşıklık.
3. **Her bulgu için:** satır veya fonksiyon adı, sorunun ne olduğu, hangi girdiyle ortaya çıktığı ve düzeltilmiş kod.
4. **Kanıt göster:** "Bu hatalı olabilir" deme; sorunu tetikleyen somut bir senaryo ver. Senaryo bulamıyorsan bunu öneri olarak işaretle.
5. **Sonuç:** Kısa bir özet ver: kaç kritik, kaç önemli bulgu var. Ardından iyi yapılmış noktaları 1-2 madde ile belirt.

Çalıştırmadığın kod için "test ettim" deme.
