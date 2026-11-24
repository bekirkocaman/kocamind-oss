package com.tyler.kocamind.ui.settings

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tyler.kocamind.data.backend.ConnectorCatalog
import com.tyler.kocamind.data.backend.ConnectorInfo
import com.tyler.kocamind.data.backend.SkillInfo
import com.tyler.kocamind.ui.theme.KocaMindTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w384dp-h832dp-xxhdpi")
class ConnectorsScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    private val calendar = ConnectorInfo("google_calendar", "Google Takvim", "Etkinliklerini listeler.", available = true, connected = false, status = null)
    private val notion = ConnectorInfo("notion", "Notion", "Sayfalarda arar.", available = true, connected = true, status = "active")
    private val github = ConnectorInfo("github", "GitHub", "Depoları okur.", available = false, connected = false, status = null)

    @Test
    fun rows_showRightActionPerState() {
        val connected = mutableListOf<String>()
        val disconnected = mutableListOf<String>()
        composeRule.setContent {
            KocaMindTheme {
                ConnectorsContent(
                    ConnectorsUiState(ConnectorCatalog(enabled = true, allowed = true, connectors = listOf(calendar, notion, github))),
                    ConnectorsActions(onConnect = { connected += it.id }, onDisconnect = { disconnected += it.id }),
                )
            }
        }
        composeRule.onNodeWithText("Bağlı").assertExists()
        composeRule.onNodeWithText("Yakında").assertExists()
        composeRule.onNodeWithText("Bağla").performClick()
        composeRule.onNodeWithText("Kes").performClick()
        assertEquals(listOf("google_calendar"), connected)
        assertEquals(listOf("notion"), disconnected)
    }

    @Test
    fun freePlan_showsPlusBadge() {
        composeRule.setContent {
            KocaMindTheme {
                ConnectorsContent(ConnectorsUiState(ConnectorCatalog(enabled = true, allowed = false, connectors = listOf(calendar))), ConnectorsActions())
            }
        }
        composeRule.onNodeWithText("Plus").assertExists()
    }

    @Test
    fun failedLoad_offersRetry() {
        var retried = 0
        composeRule.setContent {
            KocaMindTheme { ConnectorsContent(ConnectorsUiState(failed = true), ConnectorsActions(onRetry = { retried++ })) }
        }
        composeRule.onNodeWithText("Tekrar dene").performClick()
        assertEquals(1, retried)
    }

    @Test
    fun skills_groupedByAlwaysOn() {
        composeRule.setContent {
            KocaMindTheme {
                SkillsContent(
                    listOf(
                        SkillInfo("genel-asistan", "Genel asistan", "Temel davranış.", listOf("Sohbet"), alwaysOn = true),
                        SkillInfo("dilekce", "Dilekçe", "Dilekçe hazırlar.", listOf("Sohbet"), alwaysOn = false),
                    ),
                    failed = false,
                    onRetry = {},
                )
            }
        }
        composeRule.onNodeWithText("Her zaman açık").assertExists()
        composeRule.onNodeWithText("Gerektiğinde yüklenir").assertExists()
        composeRule.onNodeWithText("Dilekçe").assertExists()
    }

    @Test
    fun skills_installedSkillCanBeRemoved() {
        var removed: SkillInfo? = null
        val mine = SkillInfo("sunum", "Sunum", "Sunum hazırlar.", listOf("Her yerde"), alwaysOn = false, installed = true, sourceUrl = "https://raw.githubusercontent.com/ornek/skills/main/sunum/SKILL.md")
        composeRule.setContent {
            KocaMindTheme {
                SkillsContent(
                    listOf(mine, SkillInfo("dilekce", "Dilekçe", "Dilekçe hazırlar.", listOf("Sohbet"), alwaysOn = false)),
                    failed = false,
                    onRetry = {},
                    onRemove = { removed = it },
                )
            }
        }
        composeRule.onNodeWithText("Kurduğun skill'ler").assertExists()
        composeRule.onNodeWithText("Kaynak: github.com/ornek/skills").assertExists()
        composeRule.onNodeWithText("Kaldır").performClick()
        assertEquals(mine, removed)
    }
}
