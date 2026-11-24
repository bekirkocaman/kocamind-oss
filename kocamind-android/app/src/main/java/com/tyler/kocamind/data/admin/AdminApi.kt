package com.tyler.kocamind.data.admin

import com.google.firebase.firestore.FirebaseFirestore
import com.tyler.kocamind.data.sync.toMillis
import kotlinx.coroutines.tasks.await
import java.util.Locale

/** `users/{id}` belgesi (admin listesi). */
data class AdminUserRow(
    val id: String,
    val name: String?,
    val email: String?,
    val phone: String?,
    val lastLogin: String?,
)

data class AdminChatMessage(val role: String, val content: String)

data class AdminChat(val id: String, val title: String, val updatedAt: Long, val messages: List<AdminChatMessage>)

/** Admin ekranlarının Firestore okumaları (firestore.rules: `isAdmin()` gerekir). */
interface AdminApi {
    suspend fun users(): List<AdminUserRow>
    suspend fun chats(uid: String): List<AdminChat>
}

class FirestoreAdminApi(private val db: FirebaseFirestore) : AdminApi {
    override suspend fun users(): List<AdminUserRow> = db.collection("users").get().await().documents.map { doc ->
        AdminUserRow(
            id = doc.id,
            name = doc.getString("name"),
            email = doc.getString("email"),
            phone = doc.getString("phone"),
            lastLogin = doc.get("lastLogin")?.toString(),
        )
    }

    override suspend fun chats(uid: String): List<AdminChat> =
        db.collection("users").document(uid).collection("chats").get().await().documents.map { doc ->
            val messages = (doc.get("messages") as? List<*>).orEmpty().mapNotNull { raw ->
                val m = raw as? Map<*, *> ?: return@mapNotNull null
                AdminChatMessage(role = m["role"]?.toString() ?: "ai", content = m["content"]?.toString().orEmpty())
            }
            AdminChat(doc.id, doc.getString("title") ?: "Yeni Sohbet", toMillis(doc.get("updatedAt")), messages)
        }.sortedByDescending { it.updatedAt }
}

private fun fold(s: String?): String = s.orEmpty().lowercase(Locale.ROOT).replace("i̇", "i").replace('ı', 'i')

/** admin.tsx: son girişe göre (en yeni üstte, girişi olmayan sonda) sıralar; ad, e-posta ve kimlikte arar. */
fun adminVisibleUsers(users: List<AdminUserRow>, query: String): List<AdminUserRow> {
    val q = fold(query.trim())
    return users
        .filter { q.isEmpty() || fold(it.name).contains(q) || fold(it.email).contains(q) || fold(it.id).contains(q) }
        .sortedWith(compareBy<AdminUserRow> { it.lastLogin == null }.thenByDescending { toMillis(it.lastLogin) })
}
