"""Phosphor ikonlarını (MIT) Compose ImageVector koduna çevirir.

Kullanım: npm pack @phosphor-icons/core@2.1.1 ile paketi indirip açın, sonra
    PHOSPHOR=<paket>/assets python tools/gen_icons.py
Çıktı: app/src/main/java/com/tyler/kocamind/ui/icons/KmIcons.kt

Ağırlık "regular" (256'lık ızgarada 16 birim çizgi, 24dp'de ~1.5dp): ince ama telefonda seçilebilir.
Parıltı, robot kafası, çip gibi yapay zekâ klişesi semboller bilerek kullanılmaz.
"""
import os
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = pathlib.Path(os.environ["PHOSPHOR"])
WEIGHT = "regular"
OUT = ROOT / "app/src/main/java/com/tyler/kocamind/ui/icons/KmIcons.kt"

# Kotlin adı -> Phosphor adı
ICONS = {
    "AlignLeft": "list",
    "ArrowLeft": "arrow-left",
    "ArrowUp": "arrow-up",
    "BracketsCurly": "brackets-curly",
    "Calendar": "calendar-blank",
    "Camera": "camera",
    "Check": "check",
    "ChevronDown": "caret-down",
    "ChevronRight": "caret-right",
    "ChevronUp": "caret-up",
    "CircleCheck": "check-circle",
    "Clapperboard": "film-slate",
    "Clock": "clock",
    "CloudSlash": "cloud-slash",
    "Copy": "copy",
    "Database": "database",
    "Download": "download-simple",
    "Edit2": "pencil-simple",
    "Edit3": "pencil-simple-line",
    "Equal": "list",
    "Eye": "eye",
    "EyeOff": "eye-slash",
    "FileText": "file-text",
    "Gauge": "gauge",
    "Globe2": "globe-simple",
    "HelpCircle": "question",
    "Image": "image",
    "ImagePlus": "image",
    "Images": "images-square",
    "Info": "info",
    "LayoutGrid": "images-square",
    "Lightbulb": "lightbulb",
    "Lock": "lock-simple",
    "LogOut": "sign-out",
    "Mail": "envelope-simple",
    "MailCheck": "envelope-simple-open",
    "Menu": "list",
    "MessageCircle": "chat-circle",
    "MessageSquare": "chat",
    "MessageSquareOff": "chat-slash",
    "MessageSquarePlus": "note-pencil",
    "Mic": "microphone",
    "Notebook": "notebook",
    "NotePencil": "note-pencil",
    "Paperclip": "paperclip",
    "Pencil": "pencil-simple",
    "Phone": "phone",
    "Pin": "push-pin",
    "Plus": "plus",
    "Quotes": "quotes",
    "RotateCcw": "arrow-counter-clockwise",
    "Search": "magnifying-glass",
    "SearchX": "magnifying-glass",
    "Send": "paper-plane-right",
    "Settings": "gear-six",
    "Share2": "export",
    "Shield": "shield",
    "ShieldCheck": "shield-check",
    "Smartphone": "device-mobile",
    "Square": "stop",
    "Star": "star",
    "Terminal": "terminal-window",
    "ThumbsDown": "thumbs-down",
    "ThumbsUp": "thumbs-up",
    "Trash2": "trash",
    "User": "user",
    "Volume2": "speaker-high",
    "WifiOff": "wifi-slash",
    "X": "x",
}

suffix = "" if WEIGHT == "regular" else f"-{WEIGHT}"
lines = []
for name, ph in sorted(ICONS.items()):
    svg = (ASSETS / WEIGHT / f"{ph}{suffix}.svg").read_text(encoding="utf-8")
    paths = re.findall(r'<path d="([^"]+)"', svg)
    assert paths and "<circle" not in svg and "<rect" not in svg, ph
    args = ", ".join(f'"{d}"' for d in paths)
    lines.append(f'    val {name}: ImageVector by lazy {{ phosphor("{name}", {args}) }}')

OUT.write_text(f'''// Bu dosya tools/gen_icons.py ile üretildi; elle düzenleme.
// Kaynak: @phosphor-icons/core 2.1.1, ağırlık: {WEIGHT} (MIT lisansı).
package com.tyler.kocamind.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

private fun phosphor(name: String, vararg paths: String): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 256f, 256f).apply {{
        paths.forEach {{ d -> addPath(pathData = addPathNodes(d), fill = SolidColor(Color.Black)) }}
    }}.build()

/** Uygulamanın ikonları (Phosphor). Icon(..., tint=) ile renklendirilir. */
object KmIcons {{
{chr(10).join(lines)}
}}
''', encoding="utf-8")
print(f"{len(ICONS)} ikon -> {OUT}")
