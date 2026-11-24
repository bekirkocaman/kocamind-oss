cmake_minimum_required(VERSION 3.22.1)
project(kocamind_llama CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# llama.rn'in hazır derlenmiş saf llama.cpp kütüphaneleri (React Native bağımlılığı yok).
set(PREBUILT_DIR ${CMAKE_SOURCE_DIR}/../jniLibs/${ANDROID_ABI})

find_library(LOG_LIB log)

# Her CPU varyantı için ayrı köprü: Kotlin çalışma anında en hızlısını yükler.
function(llama_variant name)
    if (NOT EXISTS ${PREBUILT_DIR}/librnllama_${name}.so)
        return()
    endif ()
    add_library(rnllama_${name} SHARED IMPORTED)
    set_target_properties(rnllama_${name} PROPERTIES IMPORTED_LOCATION ${PREBUILT_DIR}/librnllama_${name}.so)

    add_library(kocamind_llama_${name} SHARED llama_jni.cpp)
    target_include_directories(kocamind_llama_${name} PRIVATE ${CMAKE_SOURCE_DIR}/include)
    target_link_libraries(kocamind_llama_${name} PRIVATE rnllama_${name} ${LOG_LIB})
endfunction()

llama_variant(v8)
llama_variant(v8_2_dotprod)
llama_variant(v8_2_dotprod_i8mm)
