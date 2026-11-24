package com.tyler.kocamind.ui.nav

enum class Route(val path: String, val title: String, val inDrawer: Boolean) {
    Chat("chat", "Sohbet", true),
    Library("library", "Kitaplık", true),
    Settings("settings", "Ayarlar", true),
    OfflineModels("offline-models", "Çevrimdışı AI Modelleri", false),
    CustomInstructions("custom-instructions", "Özel Talimatlar", false),
    Memory("memory", "Hafıza", false),
    Connectors("connectors", "Bağlantılar", false),
    Skills("skills", "Skill'ler", false),
    Auth("auth", "Giriş Yap", true),
    Admin("admin", "Admin Paneli", true),
    AdminUser("admin-user/{uid}?name={name}", "Kullanıcı Düzenle", false);

    companion object {
        fun adminUser(uid: String, name: String) = "admin-user/${android.net.Uri.encode(uid)}?name=${android.net.Uri.encode(name)}"
    }
}
