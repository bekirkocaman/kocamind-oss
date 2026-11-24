package com.tyler.kocamind.data.chat

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.SharedFlow

/** Drawer → sohbet ekranı komutları (eski DeviceEventEmitter `clear_chat` / `load_chat`). */
sealed interface ChatCommand {
    data object NewChat : ChatCommand
    data class LoadChat(val id: String) : ChatCommand
}

class ChatCommands {
    private val flow = MutableSharedFlow<ChatCommand>(extraBufferCapacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val commands: SharedFlow<ChatCommand> = flow

    fun send(command: ChatCommand) {
        flow.tryEmit(command)
    }

    private val open = MutableStateFlow<String?>(null)

    /** Sohbet ekranında açık olan sohbet; Ayarlar > Dışa aktar "Bu sohbet" için. */
    val openChatId: StateFlow<String?> = open

    fun setOpenChat(id: String?) {
        open.value = id
    }
}
