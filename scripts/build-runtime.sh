#!/usr/bin/env bash
# Compila o Boxedwine para WebAssembly e monta o site em dist/.
#
# O runtime é o Boxedwine (GPL-2.0) com JIT WASM, mais o sistema de arquivos
# web do Wine 11 do Boxedwine, que traz o WineD3D com patch que transforma
# DirectDraw/Direct3D em WebGL. Nenhum arquivo do jogo entra no site: o
# jogador escolhe a própria cópia no navegador.
#
# Requisitos: Linux ou WSL, git, python3, curl, sha256sum, GNU make.
# O Emscripten é instalado em $WORK/emsdk se não houver emcc no PATH.
#
# Adaptado de spiderman-2000-browser/scripts/build-runtime.sh (MIT).

set -euo pipefail

# Versões fixas (combinação já testada com jogos Direct3D antigos).
BOXEDWINE_REPO=https://github.com/danoon2/Boxedwine.git
BOXEDWINE_COMMIT=8ab37e7b79737467674b40fe0675396b3d90a469   # master, 2026-10-25 (26R2)
EMSDK_VERSION=6.0.13
FS_NAME=TinyCore15Wine11.0-web.zip
FS_URL=https://boxedwine.org/v2/23/$FS_NAME
FS_SHA256=4d505092956dd78e36712dac8111c252e5d1b859ce2373fbe7c80242bb65ad47   # web-v23

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=${WORK:-$ROOT/build}
OUT=${OUT:-$ROOT/dist}
# jit = thread única (sem cabeçalhos especiais); multiThreadedJit precisa de
# isolamento cross-origin, que o site fornece via coi-serviceworker.
TARGETS=${TARGETS:-"jit multiThreadedJit"}
JOBS=${JOBS:-$(nproc)}

declare -A TARGET_DIR=( [jit]=Jit [multiThreadedJit]=MultiThreadedJit )
declare -A SITE_DIR=( [jit]=st [multiThreadedJit]=mt )

mkdir -p "$WORK" "$OUT"

# --- Emscripten -------------------------------------------------------------
if ! command -v emcc >/dev/null 2>&1; then
    if [ ! -d "$WORK/emsdk" ]; then
        git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$WORK/emsdk"
    fi
    "$WORK/emsdk/emsdk" install "$EMSDK_VERSION"
    "$WORK/emsdk/emsdk" activate "$EMSDK_VERSION"
    # shellcheck disable=SC1091
    source "$WORK/emsdk/emsdk_env.sh"
fi
echo "emcc: $(emcc --version | head -1)"

# --- Código do Boxedwine no commit fixo ----------------------------------------
SRC="$WORK/Boxedwine"
if [ ! -d "$SRC/.git" ]; then
    git init -q "$SRC"
    git -C "$SRC" remote add origin "$BOXEDWINE_REPO"
fi
if [ "$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)" != "$BOXEDWINE_COMMIT" ]; then
    git -C "$SRC" fetch -q --depth 1 origin "$BOXEDWINE_COMMIT"
    git -C "$SRC" checkout -q --force "$BOXEDWINE_COMMIT"
fi

# Os alvos JIT substituem a lista EXPORTED_RUNTIME_METHODS e perdem o IDBFS;
# o shell então falha com "IDBFS is not defined" ao montar o C:/D:. Reexporta.
MK="$SRC/project/emscripten/makefile"
if ! grep -q '^JIT_CCALL_EXPORTS := ,ccall,IDBFS' "$MK"; then
    sed -i 's/^JIT_CCALL_EXPORTS := ,ccall$/JIT_CCALL_EXPORTS := ,ccall,IDBFS/' "$MK"
    grep -q '^JIT_CCALL_EXPORTS := ,ccall,IDBFS' "$MK" || { echo "erro: não consegui exportar IDBFS em $MK" >&2; exit 1; }
fi

# --- Compila cada runtime -------------------------------------------------------
for target in $TARGETS; do
    dir=${TARGET_DIR[$target]:?alvo desconhecido $target}
    echo "== compilando Boxedwine '$target' com $JOBS jobs"
    make -C "$SRC/project/emscripten" "$target" -j"$JOBS"
    dest="$OUT/runtime/${SITE_DIR[$target]}"
    rm -rf "$dest"
    mkdir -p "$dest"
    cp -r "$SRC/project/emscripten/Build/$dir/." "$dest/"
done

# --- Sistema de arquivos do Wine (o mesmo para os dois runtimes) ----------------
FS="$WORK/$FS_NAME"
if [ ! -f "$FS" ] || ! echo "$FS_SHA256  $FS" | sha256sum -c --status; then
    curl -fSL --retry 3 -o "$FS.part" "$FS_URL"
    mv "$FS.part" "$FS"
fi
echo "$FS_SHA256  $FS" | sha256sum -c
for target in $TARGETS; do
    cp "$FS" "$OUT/runtime/${SITE_DIR[$target]}/$FS_NAME"
done

# --- Isolamento cross-origin para o runtime multi-thread ----------------------
# O GitHub Pages não envia COOP/COEP. O coi-serviceworker (MIT) adiciona esses
# cabeçalhos por service worker para liberar SharedArrayBuffer.
if [ -d "$OUT/runtime/mt" ]; then
    COI_VERSION=0.1.7
    curl -fsSL --retry 3 -o "$OUT/runtime/mt/coi-serviceworker.js" \
        "https://cdn.jsdelivr.net/npm/coi-serviceworker@$COI_VERSION/coi-serviceworker.js"
    if ! grep -q coi-serviceworker.js "$OUT/runtime/mt/boxedwine.html"; then
        sed -i 's#<head>#<head><script src="coi-serviceworker.js"></script>#' "$OUT/runtime/mt/boxedwine.html"
    fi
fi

# --- Cache do JIT gravado (opcional) ---------------------------------------------
# jit-cache/<st|mt>/wasm-jit-modules.zip, gerado com "Save JIT Cache" no modo
# jit-record=true. O shell baixa esse zip e já começa com o código compilado.
for target in $TARGETS; do
    d=${SITE_DIR[$target]}
    if [ -f "$ROOT/jit-cache/$d/wasm-jit-modules.zip" ]; then
        cp "$ROOT/jit-cache/$d/wasm-jit-modules.zip" "$OUT/runtime/$d/"
        echo "cache do JIT incluído para $d"
    fi
done

# --- Site --------------------------------------------------------------------------
cp -r "$ROOT/site/." "$OUT/"
cp "$ROOT/LICENSES.md" "$OUT/LICENSES.md"
cat > "$OUT/build-info.json" <<EOF
{
  "boxedwineCommit": "$BOXEDWINE_COMMIT",
  "emscripten": "$(emcc --version | head -1 | sed 's/"/\\"/g')",
  "filesystem": "$FS_NAME",
  "filesystemSha256": "$FS_SHA256",
  "targets": "$TARGETS",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# Trava de segurança: nunca publicar arquivos do jogo.
if find "$OUT" -iname 'USARacer.exe' -o -iname '*.nif' -o -iname 'mss32.dll' -o -iname 'USARacer*.zip' | grep -q .; then
    echo "erro: arquivos do jogo encontrados em $OUT; eles não podem ser publicados" >&2
    exit 1
fi

echo "site montado em $OUT"
