' ═══ KocaMind Backend Otomatik Başlatıcı ═══
' Windows açılışında backend'i gizli pencerede başlatır.
' Sunucu çökerse 5 saniye sonra otomatik yeniden başlatır.

Set sh = CreateObject("Wscript.Shell")
sh.CurrentDirectory = "C:\Users\tyler\Desktop\kocamind\backend"

Do
    ' True = node bitene kadar bekle; çökerse döngü yeniden başlatır
    sh.Run "node server.js", 0, True
    WScript.Sleep 5000
Loop
