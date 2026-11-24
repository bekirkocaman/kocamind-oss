package com.tyler.kocamind.data.chat

import android.content.Context
import com.tyler.kocamind.ui.chat.ChatPrefs

/** AsyncStorage anahtarlarıyla aynı adlar: `kocamind_mobile_model`, `custom_instructions_<e-posta|guest>`. */
class SharedPrefsChatPrefs(context: Context) : ChatPrefs {
    private val prefs = context.getSharedPreferences("kocamind", Context.MODE_PRIVATE)

    override var selectedModelId: String?
        get() = prefs.getString("kocamind_mobile_model", null)
        set(value) = prefs.edit().apply { if (value == null) remove("kocamind_mobile_model") else putString("kocamind_mobile_model", value) }.apply()

    override var assistantMode: String?
        get() = prefs.getString("kocamind_mobile_mode", null)
        set(value) = prefs.edit().putString("kocamind_mobile_mode", value).apply()

    override fun customInstructions(email: String?): String =
        prefs.getString("custom_instructions_${email ?: "guest"}", "").orEmpty()

    fun setCustomInstructions(email: String?, value: String) {
        prefs.edit().putString("custom_instructions_${email ?: "guest"}", value).apply()
    }
}
