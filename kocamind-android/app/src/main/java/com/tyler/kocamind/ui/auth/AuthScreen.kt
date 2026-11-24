package com.tyler.kocamind.ui.auth

import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.Color
import androidx.compose.material3.Icon
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.tyler.kocamind.data.auth.AuthRepository
import com.tyler.kocamind.ui.components.ButtonVariant
import com.tyler.kocamind.ui.components.KmMark
import com.tyler.kocamind.ui.components.MarkState
import com.tyler.kocamind.ui.components.KmBackHeader
import com.tyler.kocamind.ui.components.KmButton
import com.tyler.kocamind.ui.components.KmIcon
import com.tyler.kocamind.ui.components.pressableScale
import com.tyler.kocamind.ui.components.rememberReduceMotion
import com.tyler.kocamind.ui.icons.KmIcons
import com.tyler.kocamind.ui.theme.KmColors
import com.tyler.kocamind.ui.theme.KmMotion
import com.tyler.kocamind.ui.theme.KmRadius
import com.tyler.kocamind.ui.theme.KmSpace
import com.tyler.kocamind.ui.theme.KmType

fun authViewModelFactory(repo: AuthRepository): ViewModelProvider.Factory = viewModelFactory {
    initializer { AuthViewModel(repo) }
}

private data class DialogState(val title: String, val message: String, val offerResend: Boolean = false)

/** kocamind-mobil/src/app/auth.tsx'in Compose karşılığı. */
@Composable
fun AuthScreen(
    viewModel: AuthViewModel,
    onSignedIn: () -> Unit,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    googleButton: (@Composable () -> Unit)? = null,
) {
    var tab by rememberSaveable { mutableStateOf(AuthTab.Login) }
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var verificationEmail by rememberSaveable { mutableStateOf<String?>(null) }
    var dialog by remember { mutableStateOf<DialogState?>(null) }
    // Önce sade karşılama; e-posta formu yalnızca istenince açılır.
    var emailForm by rememberSaveable { mutableStateOf(false) }
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val reduce = rememberReduceMotion()
    val compactHeight = LocalConfiguration.current.screenHeightDp < 740

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is AuthEvent.Error -> dialog = DialogState(event.title, event.message)
                is AuthEvent.Notice -> dialog = DialogState(event.title, event.message)
                is AuthEvent.NeedsVerification -> dialog = DialogState(
                    "E-posta Doğrulanmadı",
                    "Hesabınıza giriş yapabilmek için önce e-postanızı doğrulamanız gerekiyor. Lütfen gelen kutunuzu kontrol edin.",
                    offerResend = true,
                )
                is AuthEvent.VerificationSent -> verificationEmail = event.email
                AuthEvent.ResetSent -> dialog = DialogState(
                    "Başarılı",
                    "Şifre sıfırlama bağlantısı e-posta adresine gönderildi. Lütfen Gelen Kutusunu (veya Spam klasörünü) kontrol et.",
                )
                AuthEvent.SignedIn -> onSignedIn()
            }
        }
    }

    dialog?.let { d ->
        AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text(d.title) },
            text = { Text(d.message) },
            confirmButton = {
                if (d.offerResend) {
                    TextButton(onClick = {
                        dialog = null
                        viewModel.resendVerification(email, password)
                    }) { Text("Tekrar Gönder", color = KmColors.brand) }
                }
            },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text("Tamam", color = KmColors.brand) } },
            containerColor = KmColors.surfaceElevated,
            titleContentColor = KmColors.text,
            textContentColor = KmColors.textSecondary,
        )
    }

    val sentTo = verificationEmail
    if (sentTo != null) {
        Box(modifier) {
            VerificationSentContent(sentTo) {
                verificationEmail = null
                tab = AuthTab.Login
            }
        }
        return
    }

    if (!emailForm) {
        WelcomeContent(modifier = modifier, onBack = onBack, googleButton = googleButton, onEmail = { emailForm = true })
        return
    }
    BackHandler { emailForm = false }

    Column(modifier) {
        KmBackHeader(onBack = { emailForm = false })
        Column(
            Modifier
                .fillMaxSize()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = KmSpace.xl)
                .padding(bottom = 36.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Logo / başlık: sırayla aşağı süzülerek gelir (FadeInDown 320 ms, 0/60/120 ms gecikme).
            Column(
                Modifier
                    .widthIn(max = 540.dp)
                    .fillMaxWidth()
                    .padding(
                        top = if (compactHeight) KmSpace.xxs else KmSpace.lg,
                        bottom = if (compactHeight) KmSpace.lg else KmSpace.xxl,
                    ),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                FadeInDown(delayMs = 0, reduce = reduce) {
                    Text(
                        if (tab == AuthTab.Login) "E-posta ile giriş" else "Hesap oluştur",
                        style = KmType.title,
                        color = KmColors.text,
                    )
                }
                Spacer(Modifier.height(KmSpace.xs))
                FadeInDown(delayMs = 60, reduce = reduce) {
                    Text(
                        if (tab == AuthTab.Login) "E-postan ve şifrenle giriş yap." else "Birkaç saniyede hesabını oluştur.",
                        style = KmType.subhead,
                        color = KmColors.textSecondary,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            AuthTabs(tab = tab, reduce = reduce, onSelect = { tab = it })
            Spacer(Modifier.height(KmSpace.xl))

            Column(Modifier.widthIn(max = 540.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(KmSpace.xs)) {
                AnimatedVisibility(
                    visible = tab == AuthTab.Register,
                    enter = fadeIn(tween(if (reduce) 0 else KmMotion.FAST, easing = KmMotion.standard)) +
                        expandVertically(tween(if (reduce) 0 else KmMotion.BASE, easing = KmMotion.standard)),
                    exit = fadeOut(tween(if (reduce) 0 else KmMotion.FAST, easing = KmMotion.standard)) +
                        shrinkVertically(tween(if (reduce) 0 else KmMotion.BASE, easing = KmMotion.standard)),
                ) {
                    InputGroup("Ad Soyad") {
                        AuthInput(
                            value = name, onChange = { name = it }, placeholder = "Adınızı girin", icon = KmIcons.User,
                            tag = "auth-name", capitalization = KeyboardCapitalization.Words,
                        )
                    }
                }
                InputGroup("E-posta") {
                    AuthInput(
                        value = email, onChange = { email = it }, placeholder = "ornek@gmail.com", icon = KmIcons.Mail,
                        tag = "auth-email", keyboardType = KeyboardType.Email,
                    )
                }
                InputGroup("Şifre") {
                    AuthInput(
                        value = password, onChange = { password = it }, placeholder = "En az 6 karakter", icon = KmIcons.Lock,
                        tag = "auth-password", keyboardType = KeyboardType.Password, hidden = !showPassword,
                        trailing = {
                            Box(
                                Modifier
                                    .pressableScale(onClick = { showPassword = !showPassword })
                                    .semantics { contentDescription = if (showPassword) "Şifreyi gizle" else "Şifreyi göster" }
                                    .padding(KmSpace.xs),
                            ) {
                                KmIcon(if (showPassword) KmIcons.EyeOff else KmIcons.Eye, KmColors.textSecondary, 18.dp)
                            }
                        },
                    )
                }
                AnimatedVisibility(
                    visible = tab == AuthTab.Login,
                    modifier = Modifier.align(Alignment.End),
                    enter = fadeIn(tween(if (reduce) 0 else KmMotion.FAST, easing = KmMotion.standard)) +
                        expandVertically(tween(if (reduce) 0 else KmMotion.BASE, easing = KmMotion.standard)),
                    exit = fadeOut(tween(if (reduce) 0 else KmMotion.FAST, easing = KmMotion.standard)) +
                        shrinkVertically(tween(if (reduce) 0 else KmMotion.BASE, easing = KmMotion.standard)),
                ) {
                    Text(
                        "Şifremi Unuttum",
                        style = KmType.footnote.copy(fontWeight = FontWeight.Medium),
                        color = KmColors.brand,
                        modifier = Modifier
                            .padding(bottom = KmSpace.xs)
                            .pressableScale(onClick = { viewModel.resetPassword(email) }),
                    )
                }
                KmButton(
                    text = if (tab == AuthTab.Login) "Giriş Yap" else "Hesap Oluştur",
                    onClick = { viewModel.submit(tab, name, email, password) },
                    loading = isLoading,
                    fullWidth = true,
                    modifier = Modifier.padding(top = KmSpace.sm).testTag("auth-submit"),
                )
            }
        }
    }
}

/** Sade karşılama: ortada işaret ve isim, altta Google ve e-posta düğmeleri, en altta koşullar. */
@Composable
private fun WelcomeContent(
    modifier: Modifier,
    onBack: (() -> Unit)?,
    googleButton: (@Composable () -> Unit)?,
    onEmail: () -> Unit,
) {
    Column(modifier.fillMaxSize()) {
        if (onBack != null) KmBackHeader(onBack = onBack)
        Column(
            Modifier.weight(1f).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            KmMark(MarkState.Think, size = 48.dp)
            Spacer(Modifier.height(KmSpace.lg))
            Text("KocaMind", style = KmType.title.copy(fontSize = 28.sp, lineHeight = 34.sp), color = KmColors.text)
        }
        Column(
            Modifier
                .widthIn(max = 540.dp)
                .fillMaxWidth()
                .align(Alignment.CenterHorizontally)
                .padding(horizontal = KmSpace.xl)
                .padding(bottom = KmSpace.xl),
            verticalArrangement = Arrangement.spacedBy(KmSpace.sm + KmSpace.xxs),
        ) {
            googleButton?.invoke()
            KmButton(
                text = "E-posta ile devam et",
                onClick = onEmail,
                variant = ButtonVariant.Ghost,
                fullWidth = true,
                leftIcon = { KmIcon(KmIcons.Mail, KmColors.text, 20.dp) },
                modifier = Modifier.testTag("auth-continue-email"),
            )
            Text(
                "Devam ederek Kullanım Koşulları'nı ve Gizlilik Politikası'nı kabul edersin.",
                style = KmType.caption.copy(fontWeight = FontWeight.Normal),
                color = KmColors.textMuted,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = KmSpace.xs, start = KmSpace.md, end = KmSpace.md),
            )
        }
    }
}

/** Google'ın çok renkli "G" logosu (giriş düğmelerinde kullanım için). */
private val GoogleG: ImageVector by lazy {
    ImageVector.Builder("GoogleG", 20.dp, 20.dp, 48f, 48f).apply {
        addPath(addPathNodes("M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"), fill = SolidColor(Color(0xFFFFC107)))
        addPath(addPathNodes("M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"), fill = SolidColor(Color(0xFFFF3D00)))
        addPath(addPathNodes("M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"), fill = SolidColor(Color(0xFF4CAF50)))
        addPath(addPathNodes("M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"), fill = SolidColor(Color(0xFF1976D2)))
    }.build()
}

/** Reanimated `FadeInDown`: yukarıdan aşağı kayarak belirir. */
@Composable
private fun FadeInDown(delayMs: Int, reduce: Boolean, content: @Composable () -> Unit) {
    val progress = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!reduce) progress.animateTo(1f, tween(KmMotion.SLOW, delayMillis = delayMs, easing = KmMotion.decelerate))
    }
    Box(
        Modifier.graphicsLayer {
            alpha = progress.value
            translationY = (1f - progress.value) * -25.dp.toPx()
        },
    ) { content() }
}

@Composable
private fun AuthTabs(tab: AuthTab, reduce: Boolean, onSelect: (AuthTab) -> Unit) {
    BoxWithConstraints(
        Modifier
            .widthIn(max = 540.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(KmRadius.lg))
            .background(KmColors.surface)
            .padding(KmSpace.xs),
    ) {
        val tabWidth: Dp = maxWidth / 2
        val indicatorX by animateDpAsState(
            targetValue = if (tab == AuthTab.Login) 0.dp else tabWidth,
            animationSpec = tween(if (reduce) 0 else KmMotion.BASE, easing = KmMotion.standard),
            label = "tabIndicator",
        )
        Box(
            Modifier
                .offset(x = indicatorX)
                .width(tabWidth)
                .matchParentHeight()
                .clip(RoundedCornerShape(KmRadius.md))
                .background(KmColors.surfaceElevated),
        )
        Row(Modifier.fillMaxWidth()) {
            listOf(AuthTab.Login to "Giriş Yap", AuthTab.Register to "Kayıt Ol").forEach { (value, label) ->
                Box(
                    Modifier
                        .weight(1f)
                        .pressableScale(onClick = { onSelect(value) })
                        .padding(vertical = KmSpace.md),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label,
                        style = KmType.subhead.copy(fontWeight = FontWeight.SemiBold),
                        color = if (tab == value) KmColors.text else KmColors.textSecondary,
                    )
                }
            }
        }
    }
}

/** Gösterge kutusu, sekme satırıyla aynı yükseklikte olsun (44 dp: 12+20+12). */
private fun Modifier.matchParentHeight(): Modifier = this.height(44.dp)

@Composable
private fun InputGroup(label: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(bottom = KmSpace.md)) {
        Text(
            label,
            style = KmType.caption.copy(fontWeight = FontWeight.SemiBold),
            color = KmColors.textSecondary,
            modifier = Modifier.padding(bottom = KmSpace.sm),
        )
        content()
    }
}

@Composable
private fun AuthInput(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    icon: ImageVector,
    tag: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    hidden: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
) {
    val shape = RoundedCornerShape(KmRadius.md)
    Row(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .clip(shape)
            .background(KmColors.surface)
            .border(1.dp, KmColors.border, shape)
            .padding(horizontal = KmSpace.lg),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KmIcon(icon, KmColors.brand, 18.dp)
        Spacer(Modifier.width(KmSpace.md))
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = KmType.callout.copy(fontWeight = FontWeight.Normal, color = KmColors.text),
            cursorBrush = SolidColor(KmColors.brand),
            visualTransformation = if (hidden) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = keyboardType,
                capitalization = capitalization,
                autoCorrectEnabled = keyboardType == KeyboardType.Text,
            ),
            modifier = Modifier.weight(1f).testTag(tag),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) {
                        Text(placeholder, style = KmType.callout.copy(fontWeight = FontWeight.Normal), color = KmColors.textMuted)
                    }
                    inner()
                }
            },
        )
        trailing?.invoke()
    }
}

/** Google düğmesi: secondary Button + "G" rozeti (auth.tsx). */
@Composable
fun GoogleButton(onClick: () -> Unit, loading: Boolean, enabled: Boolean) {
    KmButton(
        text = "Google ile devam et",
        onClick = onClick,
        variant = ButtonVariant.Secondary,
        loading = loading,
        enabled = enabled,
        fullWidth = true,
        modifier = Modifier.testTag("auth-google"),
        leftIcon = { Icon(GoogleG, contentDescription = null, tint = Color.Unspecified, modifier = Modifier.size(20.dp)) },
    )
}

@Composable
private fun VerificationSentContent(email: String, onBackToLogin: () -> Unit) {
    val reduce = rememberReduceMotion()
    val alpha = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(Unit) { alpha.animateTo(1f, tween(KmMotion.FAST, easing = KmMotion.standard)) }
    Column(
        Modifier
            .fillMaxSize()
            .graphicsLayer { this.alpha = alpha.value }
            .padding(horizontal = KmSpace.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(88.dp).clip(RoundedCornerShape(KmRadius.xl)).background(KmColors.brandMuted),
            contentAlignment = Alignment.Center,
        ) { KmIcon(KmIcons.MailCheck, KmColors.brand, 40.dp) }
        Spacer(Modifier.height(KmSpace.xl))
        Text("E-postanı kontrol et", style = KmType.title, color = KmColors.text, textAlign = TextAlign.Center)
        Spacer(Modifier.height(KmSpace.lg))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = KmColors.brand, fontWeight = FontWeight.Bold)) { append(email) }
                append("\nadresine doğrulama bağlantısı gönderdik.\nMailine tıkladıktan sonra giriş yapabilirsin.")
            },
            style = KmType.callout.copy(lineHeight = 24.sp),
            color = KmColors.textSecondary,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(KmSpace.xxl))
        KmButton(text = "Giriş Yap", onClick = onBackToLogin, fullWidth = true)
    }
}
