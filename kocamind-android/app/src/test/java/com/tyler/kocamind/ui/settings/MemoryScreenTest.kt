package com.tyler.kocamind.ui.settings

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tyler.kocamind.data.memory.Memory
import com.tyler.kocamind.ui.theme.KocaMindTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w384dp-h832dp-xxhdpi")
class MemoryScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun grouping_followsCategoryOrder_unknownGoesToOther() {
        val groups = groupMemories(
            listOf(Memory("a", "1", "genel"), Memory("b", "2", "kisisel"), Memory("c", "3", null), Memory("d", "4", "saglik")),
        )
        assertEquals(listOf("Kişisel", "Sağlık", "Diğer"), groups.map { it.first })
        assertEquals(listOf("a", "c"), groups.last().second.map { it.key })
    }

    @Test
    fun empty_explainsWhatMemoryDoes() {
        composeRule.setContent {
            KocaMindTheme {
                MemoryContent(MemoryUiState(memories = emptyList()), MemoryActions())
            }
        }
        composeRule.onNodeWithText("Henüz bir şey hatırlamıyorum").assertExists()
    }

    @Test
    fun failedLoad_offersRetry() {
        var retried = 0
        composeRule.setContent {
            KocaMindTheme { MemoryContent(MemoryUiState(memories = null, failed = true), MemoryActions(onRetry = { retried++ })) }
        }
        composeRule.onNodeWithText("Tekrar dene").performClick()
        assertEquals(1, retried)
    }

    @Test
    fun item_canBeDeleted() {
        var deleted: String? = null
        composeRule.setContent {
            KocaMindTheme {
                MemoryContent(MemoryUiState(memories = listOf(Memory("şehir", "İstanbul'da yaşıyor", "kisisel"))), MemoryActions(onDelete = { deleted = it }))
            }
        }
        composeRule.onNodeWithText("İstanbul'da yaşıyor").assertExists()
        composeRule.onNodeWithContentDescription("şehir bilgisini sil").performClick()
        assertEquals("şehir", deleted)
    }

    @Test
    fun insight_showsText_andBasis() {
        composeRule.setContent {
            KocaMindTheme {
                MemoryContent(
                    MemoryUiState(memories = listOf(Memory("isim", "Bekir")), insight = InsightUi.Ready("Teknolojiye yönelmiş bir öğrencisin.", 4, 12)),
                    MemoryActions(),
                )
            }
        }
        composeRule.onNodeWithText("Teknolojiye yönelmiş bir öğrencisin.").assertExists()
        composeRule.onNodeWithText("12 sohbete ve 4 bilgiye dayanır", substring = true).assertExists()
        composeRule.onNodeWithText("taşınanlar dahil değil", substring = true).assertExists()
    }

    @Test
    fun insight_fewMemories_explains() {
        composeRule.setContent {
            KocaMindTheme { MemoryContent(MemoryUiState(memories = emptyList(), insight = InsightUi.Few), MemoryActions()) }
        }
        composeRule.onNodeWithText("Seni yorumlamak için biraz daha tanımam lazım", substring = true).assertExists()
    }

    @Test
    fun insight_failure_offersRefresh() {
        var refreshed = 0
        composeRule.setContent {
            KocaMindTheme { MemoryContent(MemoryUiState(memories = emptyList(), insight = InsightUi.Failed), MemoryActions(onRefreshInsight = { refreshed++ })) }
        }
        composeRule.onNodeWithContentDescription("Yorumu yenile").performClick()
        assertEquals(1, refreshed)
    }

    @Test
    fun importSheet_copiesPrompt_andImportsPastedText() {
        var imported: String? = null
        composeRule.setContent {
            KocaMindTheme {
                MemoryImportSheet(visible = true, onDismiss = {}, onImport = { imported = it; com.tyler.kocamind.data.memory.ImportResult(2, 0) })
            }
        }
        composeRule.onNodeWithText("İstemi kopyala").performClick()
        val clipboard = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
            .getSystemService(android.content.ClipboardManager::class.java)
        assertEquals(MEMORY_IMPORT_PROMPT, clipboard.primaryClip!!.getItemAt(0).text.toString())
        composeRule.onNodeWithContentDescription("Gelen cevap").performTextInput("- [Kişisel] isim: Bekir")
        composeRule.onNodeWithText("İçe aktar").performClick()
        composeRule.waitForIdle()
        assertEquals("- [Kişisel] isim: Bekir", imported)
    }

    @Test
    fun importSummary_namesSourceApp() {
        assertEquals("ChatGPT'den 3 bilgi hafızana eklendi.", importSummary(com.tyler.kocamind.data.memory.ImportResult(3, 0, "ChatGPT")))
        assertEquals("Yeni bir bilgi bulunamadı.", importSummary(com.tyler.kocamind.data.memory.ImportResult(0, 0, null)))
    }
}
