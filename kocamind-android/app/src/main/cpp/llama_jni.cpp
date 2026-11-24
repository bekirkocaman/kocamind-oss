// KocaMind ↔ llama.cpp köprüsü.
// llama.rn'in hazır derlenmiş librnllama_*.so kütüphanelerindeki llama C API'sini kullanır
// (React Native bağımlılığı yok). Kotlin tarafı: com.tyler.kocamind.data.offline.LlamaNative

#include <jni.h>
#include <android/log.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <string>
#include <vector>

#include "llama.h"

#define TAG "KocaMindLlama"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)

namespace {

struct Session {
    llama_model *model = nullptr;
    llama_context *ctx = nullptr;
    int n_batch = 256;
    std::atomic<bool> stop{false};
    // Son üretimin istatistikleri: [prompt tok/s, üretim tok/s, durma nedeni, üretilen token]
    double stats[4] = {0, 0, 0, 0};
};

// Durma nedenleri (Kotlin ile aynı sıra)
enum StopReason { STOP_EOS = 0, STOP_LIMIT = 1, STOP_INTERRUPTED = 2, STOP_WORD = 3, STOP_CONTEXT_FULL = 4 };

std::atomic<bool> g_backend_ready{false};

std::string to_std(JNIEnv *env, jstring value) {
    if (value == nullptr) return {};
    const jsize len = env->GetStringUTFLength(value);
    std::string out;
    // Kotlin tarafı UTF-8 baytlarını gönderir; burada yalnızca güvenli kopya alınır.
    const char *chars = env->GetStringUTFChars(value, nullptr);
    out.assign(chars, len);
    env->ReleaseStringUTFChars(value, chars);
    return out;
}

std::string bytes_to_std(JNIEnv *env, jbyteArray value) {
    if (value == nullptr) return {};
    const jsize len = env->GetArrayLength(value);
    std::string out(static_cast<size_t>(len), '\0');
    env->GetByteArrayRegion(value, 0, len, reinterpret_cast<jbyte *>(out.data()));
    return out;
}

jbyteArray to_bytes(JNIEnv *env, const std::string &value) {
    jbyteArray out = env->NewByteArray(static_cast<jsize>(value.size()));
    env->SetByteArrayRegion(out, 0, static_cast<jsize>(value.size()), reinterpret_cast<const jbyte *>(value.data()));
    return out;
}

// Sonu yarım kalan çok baytlı UTF-8 karakterini dışarıda bırakan uzunluk.
size_t complete_utf8_length(const std::string &s) {
    size_t i = s.size();
    size_t back = 0;
    while (i > 0 && back < 4) {
        const auto c = static_cast<unsigned char>(s[i - 1]);
        if ((c & 0xC0) != 0x80) {
            size_t need = 1;
            if ((c & 0xE0) == 0xC0) need = 2;
            else if ((c & 0xF0) == 0xE0) need = 3;
            else if ((c & 0xF8) == 0xF0) need = 4;
            return (back + 1 >= need) ? s.size() : i - 1;
        }
        --i;
        ++back;
    }
    return s.size();
}

std::vector<llama_token> tokenize(const llama_vocab *vocab, const std::string &text, bool add_special) {
    int n = -llama_tokenize(vocab, text.data(), static_cast<int32_t>(text.size()), nullptr, 0, add_special, true);
    std::vector<llama_token> tokens(std::max(n, 0));
    if (n > 0) {
        llama_tokenize(vocab, text.data(), static_cast<int32_t>(text.size()), tokens.data(), n, add_special, true);
    }
    return tokens;
}

std::string piece(const llama_vocab *vocab, llama_token token) {
    char buf[256];
    int n = llama_token_to_piece(vocab, token, buf, sizeof(buf), 0, false);
    if (n < 0) {
        std::string big(static_cast<size_t>(-n), '\0');
        llama_token_to_piece(vocab, token, big.data(), -n, 0, false);
        return big;
    }
    return std::string(buf, static_cast<size_t>(n));
}

// İstemi n_batch'lik parçalarla bağlama yükler.
bool decode_prompt(Session *s, std::vector<llama_token> &tokens) {
    for (size_t i = 0; i < tokens.size(); i += static_cast<size_t>(s->n_batch)) {
        const int n = static_cast<int>(std::min(tokens.size() - i, static_cast<size_t>(s->n_batch)));
        if (llama_decode(s->ctx, llama_batch_get_one(tokens.data() + i, n)) != 0) return false;
        if (s->stop.load()) return false;
    }
    return true;
}

Session *session(jlong handle) { return reinterpret_cast<Session *>(handle); }

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_tyler_kocamind_data_offline_LlamaNative_nativeLoad(JNIEnv *env, jobject, jstring path, jint n_ctx, jint n_batch, jint n_threads) {
    if (!g_backend_ready.exchange(true)) llama_backend_init();

    llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = 0;  // CPU modu: her cihazda çalışır
    mparams.use_mmap = true;

    const std::string model_path = to_std(env, path);
    llama_model *model = llama_model_load_from_file(model_path.c_str(), mparams);
    if (model == nullptr) {
        LOGW("Model açılamadı: %s", model_path.c_str());
        return 0;
    }

    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx = static_cast<uint32_t>(n_ctx);
    cparams.n_batch = static_cast<uint32_t>(n_batch);
    cparams.n_ubatch = static_cast<uint32_t>(n_batch);
    cparams.n_threads = n_threads;
    cparams.n_threads_batch = n_threads;
    cparams.no_perf = false;

    llama_context *ctx = llama_init_from_model(model, cparams);
    if (ctx == nullptr) {
        LOGW("Bağlam oluşturulamadı");
        llama_model_free(model);
        return 0;
    }
    auto *s = new Session();
    s->model = model;
    s->ctx = ctx;
    s->n_batch = n_batch;
    LOGI("Model yüklendi: ctx=%d batch=%d threads=%d", n_ctx, n_batch, n_threads);
    return reinterpret_cast<jlong>(s);
}

JNIEXPORT void JNICALL
Java_com_tyler_kocamind_data_offline_LlamaNative_nativeFree(JNIEnv *, jobject, jlong handle) {
    Session *s = session(handle);
    if (s == nullptr) return;
    if (s->ctx) llama_free(s->ctx);
    if (s->model) llama_model_free(s->model);
    delete s;
}

JNIEXPORT void JNICALL
Java_com_tyler_kocamind_data_offline_LlamaNative_nativeStop(JNIEnv *, jobject, jlong handle) {
    Session *s = session(handle);
    if (s) s->stop.store(true);
}

// Modelin kendi sohbet şablonuyla mesajları biçimler (UTF-8 bayt dizileri).
JNIEXPORT jbyteArray JNICALL
Java_com_tyler_kocamind_data_offline_LlamaNative_nativeFormatChat(JNIEnv *env, jobject, jlong handle, jobjectArray roles, jobjectArray contents) {
    Session *s = session(handle);
    const jsize n = env->GetArrayLength(roles);
    std::vector<std::string> role_store(n), content_store(n);
    std::vector<llama_chat_message> messages(n);
    for (jsize i = 0; i < n; ++i) {
        role_store[i] = bytes_to_std(env, static_cast<jbyteArray>(env->GetObjectArrayElement(roles, i)));
        content_store[i] = bytes_to_std(env, static_cast<jbyteArray>(env->GetObjectArrayElement(contents, i)));
    }
    for (jsize i = 0; i < n; ++i) messages[i] = {role_store[i].c_str(), content_store[i].c_str()};

    const char *tmpl = llama_model_chat_template(s->model, nullptr);
    std::vector<char> buf(8192);
    int len = llama_chat_apply_template(tmpl, messages.data(), messages.size(), true, buf.data(), static_cast<int32_t>(buf.size()));
    if (len > static_cast<int>(buf.size())) {
        buf.resize(static_cast<size_t>(len));
        len = llama_chat_apply_template(tmpl, messages.data(), messages.size(), true, buf.data(), static_cast<int32_t>(buf.size()));
    }
    if (len < 0) {
        // Tanınmayan şablon: chatml yedeği (Qwen biçimi).
        len = llama_chat_apply_template("chatml", messages.data(), messages.size(), true, buf.data(), static_cast<int32_t>(buf.size()));
        if (len > static_cast<int>(buf.size())) {
            buf.resize(static_cast<size_t>(len));
            len = llama_chat_apply_template("chatml", messages.data(), messages.size(), true, buf.data(), static_cast<int32_t>(buf.size()));
        }
    }
    return to_bytes(env, std::string(buf.data(), static_cast<size_t>(std::max(len, 0))));
}

JNIEXPORT jint JNICALL
Java_com_tyler_kocamind_data_offline_LlamaNative_nativeCountTokens(JNIEnv *env, jobject, jlong handle, jbyteArray text) {
    Session *s = session(handle);
    return static_cast<jint>(tokenize(llama_model_get_vocab(s->model), bytes_to_std(env, text), true).size());
}

JNIEXPORT jint JNICALL
Java_com_tyler_kocamind_data_offline_LlamaNative_nativeContextSize(JNIEnv *, jobject, jlong handle) {
    return static_cast<jint>(llama_n_ctx(session(handle)->ctx));
}

// Akışla cevap üretir. Her yeni parçada callback.onPartial(byte[]) çağrılır (o ana kadarki tüm metin).
JNIEXPORT jbyteArray JNICALL
Java_com_tyler_kocamind_data_offline_LlamaNative_nativeGenerate(
    JNIEnv *env, jobject, jlong handle, jbyteArray prompt_bytes, jint n_predict,
    jfloat temp, jfloat top_p, jint top_k, jfloat min_p, jobjectArray stop_words, jobject callback) {
    Session *s = session(handle);
    s->stop.store(false);
    for (double &v : s->stats) v = 0;

    const llama_vocab *vocab = llama_model_get_vocab(s->model);
    llama_memory_clear(llama_get_memory(s->ctx), true);

    std::vector<std::string> stops;
    for (jsize i = 0; i < env->GetArrayLength(stop_words); ++i) {
        stops.push_back(bytes_to_std(env, static_cast<jbyteArray>(env->GetObjectArrayElement(stop_words, i))));
    }

    jclass cb_class = env->GetObjectClass(callback);
    jmethodID on_partial = env->GetMethodID(cb_class, "onPartial", "([B)V");

    // Şablon özel tokenları zaten içerir; BOS'u yalnızca model istiyorsa tokenizer ekler.
    std::vector<llama_token> tokens = tokenize(vocab, bytes_to_std(env, prompt_bytes), true);
    const int n_ctx = static_cast<int>(llama_n_ctx(s->ctx));
    if (static_cast<int>(tokens.size()) >= n_ctx - 4) {
        s->stats[2] = STOP_CONTEXT_FULL;
        return to_bytes(env, "");
    }

    const auto t0 = std::chrono::steady_clock::now();
    if (!decode_prompt(s, tokens)) {
        s->stats[2] = s->stop.load() ? STOP_INTERRUPTED : STOP_CONTEXT_FULL;
        return to_bytes(env, "");
    }
    const auto t1 = std::chrono::steady_clock::now();
    const double prompt_sec = std::chrono::duration<double>(t1 - t0).count();
    s->stats[0] = prompt_sec > 0 ? tokens.size() / prompt_sec : 0;

    llama_sampler *smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (top_k > 0) llama_sampler_chain_add(smpl, llama_sampler_init_top_k(top_k));
    if (top_p < 1.0f) llama_sampler_chain_add(smpl, llama_sampler_init_top_p(top_p, 1));
    if (min_p > 0.0f) llama_sampler_chain_add(smpl, llama_sampler_init_min_p(min_p, 1));
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(temp));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    std::string text;
    size_t sent = 0;
    int n_past = static_cast<int>(tokens.size());
    int generated = 0;
    StopReason reason = STOP_LIMIT;

    for (; generated < n_predict; ++generated) {
        if (s->stop.load()) { reason = STOP_INTERRUPTED; break; }
        llama_token token = llama_sampler_sample(smpl, s->ctx, -1);
        if (llama_vocab_is_eog(vocab, token)) { reason = STOP_EOS; break; }
        text += piece(vocab, token);

        bool hit_stop = false;
        for (const auto &stop : stops) {
            const size_t pos = stop.empty() ? std::string::npos : text.find(stop);
            if (pos != std::string::npos) {
                text.resize(pos);
                hit_stop = true;
                break;
            }
        }

        const size_t complete = complete_utf8_length(text);
        if (complete > sent) {
            sent = complete;
            jbyteArray partial = to_bytes(env, text.substr(0, complete));
            env->CallVoidMethod(callback, on_partial, partial);
            env->DeleteLocalRef(partial);
        }
        if (hit_stop) { reason = STOP_WORD; ++generated; break; }
        if (n_past + 1 >= n_ctx) { reason = STOP_CONTEXT_FULL; ++generated; break; }

        if (llama_decode(s->ctx, llama_batch_get_one(&token, 1)) != 0) { reason = STOP_CONTEXT_FULL; ++generated; break; }
        ++n_past;
    }
    llama_sampler_free(smpl);

    const double gen_sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t1).count();
    s->stats[1] = gen_sec > 0 && generated > 0 ? generated / gen_sec : 0;
    s->stats[2] = reason;
    s->stats[3] = generated;
    return to_bytes(env, text.substr(0, complete_utf8_length(text)));
}

JNIEXPORT jdoubleArray JNICALL
Java_com_tyler_kocamind_data_offline_LlamaNative_nativeLastStats(JNIEnv *env, jobject, jlong handle) {
    jdoubleArray out = env->NewDoubleArray(4);
    env->SetDoubleArrayRegion(out, 0, 4, session(handle)->stats);
    return out;
}

// Gerçek cihaz hız testi (llama.rn `bench(64, 16, 1, 1)` karşılığı): [prompt tok/s, üretim tok/s]
JNIEXPORT jdoubleArray JNICALL
Java_com_tyler_kocamind_data_offline_LlamaNative_nativeBench(JNIEnv *env, jobject, jlong handle, jint pp, jint tg) {
    Session *s = session(handle);
    const llama_vocab *vocab = llama_model_get_vocab(s->model);
    llama_memory_clear(llama_get_memory(s->ctx), true);

    std::vector<llama_token> prompt(static_cast<size_t>(pp), llama_vocab_bos(vocab) >= 0 ? llama_vocab_bos(vocab) : 0);
    const auto t0 = std::chrono::steady_clock::now();
    decode_prompt(s, prompt);
    const auto t1 = std::chrono::steady_clock::now();

    llama_token token = prompt.empty() ? 0 : prompt.back();
    for (int i = 0; i < tg; ++i) {
        if (llama_decode(s->ctx, llama_batch_get_one(&token, 1)) != 0) break;
    }
    const auto t2 = std::chrono::steady_clock::now();
    llama_memory_clear(llama_get_memory(s->ctx), true);

    const double pp_sec = std::chrono::duration<double>(t1 - t0).count();
    const double tg_sec = std::chrono::duration<double>(t2 - t1).count();
    double result[2] = {pp_sec > 0 ? pp / pp_sec : 0, tg_sec > 0 ? tg / tg_sec : 0};
    jdoubleArray out = env->NewDoubleArray(2);
    env->SetDoubleArrayRegion(out, 0, 2, result);
    return out;
}

}  // extern "C"
