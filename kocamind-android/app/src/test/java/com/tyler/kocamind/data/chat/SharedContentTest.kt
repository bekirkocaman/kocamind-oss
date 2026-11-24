package com.tyler.kocamind.data.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SharedContentTest {
    private val own = "com.tyler.kocamind.files"
    private val send = "android.intent.action.SEND"

    private fun parse(type: String?, text: String? = null, stream: String? = null, action: String? = send) =
        parseShare(action, type, text, stream, own)

    @Test fun text_isTrimmed() {
        assertEquals(SharedContent(text = "https://ornek.com"), parse("text/plain", text = "  https://ornek.com \n"))
    }

    @Test fun blankText_isIgnored() {
        assertNull(parse("text/plain", text = "   "))
        assertNull(parse("text/plain"))
    }

    @Test fun otherActions_areIgnored() {
        assertNull(parse("text/plain", text = "selam", action = "android.intent.action.VIEW"))
        assertNull(parse("text/plain", text = "selam", action = null))
    }

    @Test fun image_keepsCaption() {
        assertEquals(
            SharedContent(text = "bu ne?", imageUri = "content://media/external/images/1"),
            parse("image/jpeg", text = "bu ne?", stream = "content://media/external/images/1"),
        )
    }

    @Test fun documents_matchThePickerTypes() {
        val uri = "content://com.android.providers.downloads.documents/document/7"
        assertEquals(SharedContent(documentUri = uri), parse("application/pdf", stream = uri))
        assertEquals(SharedContent(documentUri = uri), parse("application/json", stream = uri))
        assertEquals(SharedContent(documentUri = uri), parse("TEXT/Plain; charset=utf-8", stream = uri))
    }

    @Test fun unsupportedFile_fallsBackToText() {
        val uri = "content://media/external/video/3"
        assertEquals(SharedContent(text = "video"), parse("video/mp4", text = "video", stream = uri))
        assertNull(parse("video/mp4", stream = uri))
    }

    @Test fun fileUris_areRejected() {
        assertNull(parse("image/png", stream = "file:///data/data/com.tyler.kocamind/files/attachments/a.jpg"))
        assertEquals(SharedContent(text = "not"), parse("application/pdf", text = "not", stream = "file:///sdcard/a.pdf"))
    }

    @Test fun ownProvider_isRejected() {
        assertNull(parse("image/jpeg", stream = "content://com.tyler.kocamind.files/camera/camera-1.jpg"))
        assertNull(parse("image/jpeg", stream = "content://10@com.tyler.kocamind.files/camera/camera-1.jpg"))
        assertNull(parse("image/jpeg", stream = "content://"))
    }

    @Test fun mergeSharedText_appendsBelowDraft() {
        assertEquals("yeni", mergeSharedText("", "yeni"))
        assertEquals("yeni", mergeSharedText("  \n", "yeni"))
        assertEquals("bunu özetle\n\nyeni", mergeSharedText("bunu özetle \n", "yeni"))
    }
}
