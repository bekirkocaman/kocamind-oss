package com.tyler.kocamind.data.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AndroidMediaFilesTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun importImage_appliesExifRotation() = runTest {
        // Telefon kamerası: piksel yatay (40x20), EXIF "90° döndür" diyor.
        val source = File(context.cacheDir, "exif.jpg")
        source.outputStream().use { Bitmap.createBitmap(40, 20, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.JPEG, 90, it) }
        ExifInterface(source.path).apply {
            setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString())
            saveAttributes()
        }
        val media = AndroidMediaFiles(context, LibraryStore(context.filesDir))
        val imported = media.importImage(Uri.fromFile(source))
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(Uri.parse(imported.uri).path, bounds)
        assertEquals(20, bounds.outWidth)
        assertEquals(40, bounds.outHeight)
    }
}
