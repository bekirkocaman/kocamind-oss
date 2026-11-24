package com.tyler.kocamind.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class IntentRouterTest {
    @Test fun media_requests() {
        assertEquals(RoutedIntent.Media(MediaKind.Image, "1:1"), routeIntent("Bana kırmızı bir araba görseli çiz"))
        assertEquals(RoutedIntent.Media(MediaKind.Image, "9:16"), routeIntent("Telefon için dikey duvar kağıdı oluştur"))
        assertEquals(RoutedIntent.Media(MediaKind.Video, "16:9"), routeIntent("Denizde gün batımı videosu üret"))
        assertEquals(RoutedIntent.Media(MediaKind.Video, "9:16"), routeIntent("TikTok için reels video yap"))
    }

    @Test fun mediaWords_withoutCreateVerb_stayChat() {
        assertEquals(RoutedIntent.Chat, routeIntent("Bu fotoğraftaki kuş hangi tür?"))
        assertEquals(RoutedIntent.Chat, routeIntent("Video montajı nasıl öğrenilir"))
    }

    @Test fun deepResearch_requests() {
        assertEquals(RoutedIntent.Mode(AssistantMode.DeepResearch), routeIntent("Elektrikli arabalar hakkında detaylı araştırma yap"))
        assertEquals(RoutedIntent.Mode(AssistantMode.DeepResearch), routeIntent("iPhone ve Samsung'u kaynaklarla karşılaştırıp rapor hazırla"))
    }

    @Test fun agent_requests() {
        assertEquals(RoutedIntent.Mode(AssistantMode.Agent), routeIntent("https://example.com sayfasını oku ve özetle"))
        assertEquals(RoutedIntent.Mode(AssistantMode.Agent), routeIntent("Bu kodu çalıştır ve sonucu söyle"))
        assertEquals(RoutedIntent.Mode(AssistantMode.Agent), routeIntent("Ahmet'e mail gönder"))
    }

    @Test fun everydayQuestions_stayChat() {
        assertEquals(RoutedIntent.Chat, routeIntent("naber"))
        assertEquals(RoutedIntent.Chat, routeIntent("17 x 23 kaç eder"))
        assertEquals(RoutedIntent.Chat, routeIntent("Bugün İstanbul'da hava nasıl"))
        assertEquals(RoutedIntent.Chat, routeIntent("Python'da liste nasıl sıralanır"))
    }
}
