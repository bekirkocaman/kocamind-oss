package com.tyler.kocamind.data.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import com.tyler.kocamind.ui.chat.Attachment
import com.tyler.kocamind.ui.chat.MediaFiles
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.Instant

/** Galeri/kamera/belge dosyalarını uygulama klasörüne alır, üretilen görselleri kaydeder. */
class AndroidMediaFiles(private val context: Context, private val library: LibraryStore) : MediaFiles {

    override suspend fun read(uri: String): ByteArray = withContext(Dispatchers.IO) {
        context.contentResolver.openInputStream(Uri.parse(uri))?.use { it.readBytes() }
            ?: throw IllegalStateException("Dosya okunamadı.")
    }

    override suspend fun saveGeneratedImage(base64: String, mimeType: String, timestamp: Long): String = withContext(Dispatchers.IO) {
        val ext = if (mimeType.contains("jpeg")) "jpg" else "png"
        val file = File(File(context.filesDir, "generated").apply { mkdirs() }, "kocamind-generated-$timestamp.$ext")
        file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
        Uri.fromFile(file).toString()
    }

    override suspend fun addToLibrary(uri: String, prompt: String?, generated: Boolean) {
        library.add(LibraryImage(uri = uri, date = Instant.now().toString(), generated = generated, prompt = prompt))
    }

    /**
     * Seçilen görseli 1600 px'e küçültüp %72 JPEG olarak uygulama klasörüne kopyalar
     * (eski uygulamadaki `quality: 0.72` ile aynı). Kalıcı bir dosya adresi döner.
     */
    suspend fun importImage(source: Uri): Attachment = withContext(Dispatchers.IO) {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(source)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
        val decoded = context.contentResolver.openInputStream(source)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: throw IllegalStateException("Fotoğraf okunamadı.")
        // JPEG'e yeniden yazınca EXIF yön bilgisi kaybolur; dikey çekilmiş foto yan gitmesin diye pikselleri döndür.
        val bitmap = rotateByExif(source, decoded)
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 72, out)
        val file = File(File(context.filesDir, "attachments").apply { mkdirs() }, "photo-${System.currentTimeMillis()}.jpg")
        file.writeBytes(out.toByteArray())
        Attachment(Uri.fromFile(file).toString(), "image/jpeg", file.name)
    }

    private fun rotateByExif(source: Uri, bitmap: Bitmap): Bitmap {
        val orientation = runCatching {
            context.contentResolver.openInputStream(source)?.use {
                ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            }
        }.getOrNull() ?: ExifInterface.ORIENTATION_NORMAL
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(270f); matrix.postScale(-1f, 1f) }
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    /** Belgeyi gerçek adıyla uygulama klasörüne kopyalar. */
    suspend fun importDocument(source: Uri): Attachment = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val name = resolver.query(source, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        } ?: "belge"
        val mime = resolver.getType(source) ?: "application/octet-stream"
        val file = File(File(context.filesDir, "attachments").apply { mkdirs() }, "${System.currentTimeMillis()}-$name")
        resolver.openInputStream(source)?.use { input -> file.outputStream().use { input.copyTo(it) } }
            ?: throw IllegalStateException("Dosya okunamadı.")
        Attachment(Uri.fromFile(file).toString(), mime, name)
    }

    /** Kamera çekimi için boş dosya ve FileProvider adresi. */
    fun newCameraFile(): Pair<File, Uri> {
        val file = File(File(context.cacheDir, "camera").apply { mkdirs() }, "camera-${System.currentTimeMillis()}.jpg")
        val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        return file to uri
    }
}
