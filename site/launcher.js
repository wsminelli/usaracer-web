// Launcher do US Racer (Davilex, 2001) no navegador, sobre o Boxedwine.
//
// O jogo é lido uma vez (de um .zip ou de uma pasta) e gravado no IndexedDB
// que o Boxedwine monta como drive D:. Nada é enviado para servidor nenhum.
//
// Estrutura baseada no launcher do projeto spiderman-2000-browser (MIT),
// https://github.com/HarshitPeriwal/spiderman-2000-browser

const ROOT_FS = "TinyCore15Wine11.0-web";
const STORAGE_KEY = "usaracer";

// Precisa bater com configureBrowserStorage() do Boxedwine: storageKey=<k>
// monta o D: em /d_drive/key/<k>, e o IDBFS do Emscripten guarda cada ponto
// de montagem num banco com o mesmo nome do caminho.
const D_DRIVE = "/d_drive/key/" + encodeURIComponent(STORAGE_KEY);
const IDB_VERSION = 21;           // IDBFS.DB_VERSION
const IDB_STORE = "FILE_DATA";    // IDBFS.DB_STORE_NAME
const MODE_DIR = 0o40777;
const MODE_FILE = 0o100666;

// Arquivos que o jogo precisa (caminhos relativos à pasta do jogo, minúsculos).
const REQUIRED = [
  "usaracer.exe", "mss32.dll", "usaracermain.ini", "gameobjecttypes.ini",
  "data/common/fixeddata.ini", "data/common/language.ini", "data/common/savegame.usr",
  "data/tracks/track01.nif", "data/menu/wintrackselect.nif",
];

// Wrappers de DirectX e restos de instalador. O Wine procura DLLs na pasta do
// jogo antes do system32; um ddraw.dll aqui esconderia o ddraw WebGL do Boxedwine.
const EXCLUDED = new Set([
  "ddraw.dll", "d3d8.dll", "d3d9.dll", "d3dimm.dll", "dxgi.dll", "dinput.dll", "dinput8.dll",
  "dsound.dll", "winmm.dll", "dgvoodoo.conf", "dgvoodoocpl.exe", "dgvoodoo.dll",
  "unwise.exe", "uninst32.exe", "install.log", "autorun.exe",
]);

// USARacer.exe: três variantes conhecidas.
const EXE_SIZE = 2854912;
const EXE_PATCHED = "fc2a92f2041aaabba2d09c867a495c70746e6be5db04f28e6cdc7deba0f6a1f1";
const EXE_NOCD = "2b8ae62c1fbd185f0f99de7c3e4edced36be0a5b78a85a69d91149675809ec18";
const EXE_CD = "2909c712a4551aa6ddf64a82855c401c3618db23dca4068bf406a5bed79417e0";
// Patch de compatibilidade: força o modo de vídeo de 16 para 32 bits. Em 16
// bits o ddraw do Wine (9 e 11) falha ao criar texturas DXT com mipmap e o
// jogo fecha ao carregar o menu.
const EXE_PATCHES = [
  { offset: 0x117aef, from: "b810000000", to: "b820000000" },       // bpp do renderer
  { offset: 0x11866b, from: "b810000000", to: "b820000000" },       // getter de bpp
  { offset: 0x1ecd45, from: "8bbc24a0000000", to: "bf200000009090" }, // SetDisplayMode
  // O navegador só oferece 640x480x32; a tabela de modos passa a marcar a
  // profundidade "16" quando encontra um modo de 32 bits (senão: Illegal Bitdepth).
  { offset: 0x125a4c, from: "b810000000", to: "b820000000" },
];

const $ = (id) => document.getElementById(id);
let source = null;   // [{ path, dir?, size, getFile }] relativos à pasta do jogo

function fmtSize(bytes) {
  if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + " MB";
  if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(0) + " KB";
  return bytes + " B";
}

function addRow(list, name, detail, cls) {
  const li = document.createElement("li");
  const a = document.createElement("span");
  const b = document.createElement("span");
  a.textContent = name;
  b.textContent = detail;
  if (cls) b.className = cls;
  li.append(a, b);
  list.append(li);
}

function setStatus(el, text, cls) {
  el.textContent = text;
  el.className = "status" + (cls ? " " + cls : "");
}

const hexToBytes = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function sha256(bytes) {
  if (!crypto?.subtle) return null;
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

// --- IndexedDB (drive D: do Boxedwine) ------------------------------------------

function openDrive() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(D_DRIVE, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const store = db.objectStoreNames.contains(IDB_STORE)
        ? e.target.transaction.objectStore(IDB_STORE)
        : db.createObjectStore(IDB_STORE);
      if (!store.indexNames.contains("timestamp")) store.createIndex("timestamp", "timestamp", { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("transação abortada"));
  });
}

async function putEntries(db, entries) {
  const tx = db.transaction(IDB_STORE, "readwrite");
  const store = tx.objectStore(IDB_STORE);
  for (const [path, entry] of entries) store.put(entry, D_DRIVE + "/" + path);
  await txDone(tx);
}

async function installedFiles() {
  const db = await openDrive();
  try {
    const tx = db.transaction(IDB_STORE, "readonly");
    const keys = await new Promise((resolve, reject) => {
      const req = tx.objectStore(IDB_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new Set(keys.map((k) => String(k).slice(D_DRIVE.length + 1).toLowerCase()));
  } finally {
    db.close();
  }
}

async function isInstalled() {
  try {
    const files = await installedFiles();
    return REQUIRED.every((f) => files.has(f));
  } catch {
    return false;
  }
}

function removeInstalled() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(D_DRIVE);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("feche a aba do jogo primeiro"));
  });
}

// --- Navegador ---------------------------------------------------------------

function checkSupport() {
  const list = $("support-list");
  const gl2 = (() => {
    try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
  })();
  const checks = [
    ["WebAssembly", typeof WebAssembly === "object"],
    ["WebGL 2", gl2],
    ["Armazenamento (IndexedDB)", typeof indexedDB === "object"],
    ["Contexto seguro (https ou localhost)", window.isSecureContext],
    ["Descompressão de zip", typeof DecompressionStream === "function"],
  ];
  for (const [name, ok] of checks) addRow(list, name, ok ? "ok" : "falta", ok ? "ok" : "bad");
  addRow(list, "Recomendado", "Chrome ou Edge 137+, Firefox 131+", "");
}

// --- Leitura de .zip (sem biblioteca) ------------------------------------------
// Lê o diretório central e fatia o File; entradas "store" viram Blob sem cópia,
// entradas "deflate" passam por DecompressionStream("deflate-raw").

async function readZip(file) {
  const tailLen = Math.min(file.size, 65557);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("não é um arquivo .zip válido");
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) throw new Error("zip64 não suportado");
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const utf8 = new TextDecoder("utf-8");
  const latin = new TextDecoder("latin1");
  const out = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error("diretório central do zip corrompido");
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const compSize = cd.getUint32(p + 20, true);
    const size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOffset = cd.getUint32(p + 42, true);
    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen);
    const name = ((flags & 0x800) ? utf8 : latin).decode(nameBytes).replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.startsWith("__MACOSX/")) continue;
    if (name.endsWith("/")) { out.push({ path: name.slice(0, -1), dir: true }); continue; }
    if (method !== 0 && method !== 8) throw new Error(`compressão ${method} não suportada em ${name}`);
    const getFile = async () => {
      const lh = new DataView(await file.slice(localOffset, localOffset + 30).arrayBuffer());
      if (lh.getUint32(0, true) !== 0x04034b50) throw new Error("cabeçalho local inválido: " + name);
      const start = localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const raw = file.slice(start, start + compSize);
      if (method === 0) return raw;
      const stream = raw.stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(stream).blob();
    };
    out.push({ path: name, size, getFile });
  }
  return out;
}

function fromFileList(files) {
  // webkitRelativePath é "<pasta escolhida>/<caminho dentro dela>"
  return Array.from(files, (f) => ({
    path: f.webkitRelativePath || f.name, size: f.size, getFile: async () => f,
  }));
}

// Acha a pasta que contém o USARacer.exe e deixa os caminhos relativos a ela.
function rebase(entries) {
  const files = entries.filter((e) => !e.dir && e.path);
  const exe = files.find((e) => /(^|\/)usaracer\.exe$/i.test(e.path) && !/\/redist\//i.test(e.path));
  if (!exe) return null;
  const prefix = exe.path.slice(0, exe.path.length - "usaracer.exe".length);
  const out = [];
  const dirs = new Set();
  for (const e of files) {
    if (!e.path.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const rel = e.path.slice(prefix.length);
    if (!rel) continue;
    const parts = rel.split("/");
    if (parts.includes("..")) continue;
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    out.push({ ...e, path: rel });
  }
  for (const d of dirs) out.push({ path: d, dir: true });
  return out;
}

function isExcluded(path) {
  const lower = path.toLowerCase();
  if (lower.includes("/")) return lower.startsWith("data/video/");   // vídeos MP42 não tocam no Wine
  return EXCLUDED.has(lower) || lower.endsWith(".log");
}

// Retorna { bytes, state } para o executável, já com o patch aplicado se preciso.
async function prepareExe(entry) {
  const bytes = new Uint8Array(await (await entry.getFile()).arrayBuffer());
  if (bytes.length !== EXE_SIZE) return { bytes, state: "unknown" };
  const hash = await sha256(bytes);
  if (hash === EXE_CD) return { bytes, state: "cd" };
  const matches = (patch, key) => bytesToHex(bytes.subarray(patch.offset, patch.offset + patch[key].length / 2)) === patch[key];
  if (hash === EXE_PATCHED || EXE_PATCHES.every((pt) => matches(pt, "to"))) return { bytes, state: "patched" };
  // NoCD sem patch, ou com só parte dos patches (versões anteriores do zip).
  if (hash === EXE_NOCD || EXE_PATCHES.every((pt) => matches(pt, "from") || matches(pt, "to"))) {
    for (const pt of EXE_PATCHES) bytes.set(hexToBytes(pt.to), pt.offset);
    return { bytes, state: "patched-now" };
  }
  return { bytes, state: "unknown" };
}

async function checkSource(raw) {
  const status = $("source-status");
  const list = $("source-files");
  list.replaceChildren();
  source = null;
  $("install").disabled = true;

  const entries = rebase(raw);
  if (!entries) {
    setStatus(status, "Não achei o USARacer.exe aí. Escolha o USARacer-jogo.zip ou a pasta que contém o USARacer.exe.", "bad");
    return;
  }
  const byPath = new Map(entries.filter((e) => !e.dir).map((e) => [e.path.toLowerCase(), e]));
  let ok = true;
  for (const req of REQUIRED) {
    const e = byPath.get(req);
    if (!e) { addRow(list, req, "faltando", "bad"); ok = false; continue; }
    if (req === "usaracer.exe") continue;
    addRow(list, e.path, fmtSize(e.size), "ok");
  }

  const exeEntry = byPath.get("usaracer.exe");
  if (exeEntry) {
    const exe = await prepareExe(exeEntry);
    const msg = {
      "patched": ["NoCD com patches de 32 bits", "ok"],
      "patched-now": ["NoCD; patches de 32 bits serão aplicados", "ok"],
      "cd": ["é o exe original do CD (com proteção); use o da pasta NoCD", "bad"],
      "unknown": ["versão desconhecida; pode não funcionar", "warn"],
    }[exe.state];
    addRow(list, exeEntry.path, `${fmtSize(exe.bytes.length)}, ${msg[0]}`, msg[1]);
    if (exe.state === "cd") ok = false;
    exeEntry.bytes = exe.bytes;
  }

  const files = entries.filter((e) => !e.dir && !isExcluded(e.path));
  const total = files.reduce((n, e) => n + (e.size || 0), 0);
  if (!ok) {
    setStatus(status, "Esta pasta/zip não está completa. Use o USARacer-jogo.zip preparado.", "bad");
    return;
  }
  setStatus(status, `Jogo encontrado: ${files.length} arquivos, ${fmtSize(total)}.`, "ok");
  source = entries;
  $("install").disabled = false;
}

// --- Instalação no navegador --------------------------------------------------

async function install() {
  const status = $("install-status");
  const bar = $("install-progress");
  $("install").disabled = true;
  $("pick-zip").disabled = $("pick-folder").disabled = true;
  const done = (enable) => { $("install").disabled = !enable; $("pick-zip").disabled = $("pick-folder").disabled = false; };

  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch {}
  }
  const plan = source.filter((e) => !isExcluded(e.path));
  const files = plan.filter((e) => !e.dir);
  const total = files.reduce((n, f) => n + (f.size || 0), 0);

  if (navigator.storage?.estimate) {
    const { quota = Infinity, usage = 0 } = await navigator.storage.estimate();
    if (quota - usage < total * 1.1) {
      setStatus(status, `Pouco espaço no navegador: precisa de ${fmtSize(total)}, há ${fmtSize(quota - usage)} livres.`, "bad");
      done(true);
      return;
    }
  }

  let db;
  let written = 0;
  bar.hidden = false;
  bar.max = total;
  bar.value = 0;
  try {
    await removeInstalled();   // começa de um drive limpo
    db = await openDrive();
    const now = new Date();
    await putEntries(db, plan.filter((e) => e.dir).map((d) => [d.path, { timestamp: now, mode: MODE_DIR }]));
    // Grava em lotes de ~8 MB por transação.
    let batch = [];
    let batchBytes = 0;
    for (const f of files) {
      const contents = f.bytes || new Uint8Array(await (await f.getFile()).arrayBuffer());
      batch.push([f.path, { timestamp: now, mode: MODE_FILE, contents }]);
      batchBytes += contents.length;
      written += contents.length;
      if (batchBytes >= 8 << 20) {
        await putEntries(db, batch);
        batch = [];
        batchBytes = 0;
        bar.value = written;
        setStatus(status, `Instalando... ${fmtSize(written)} de ${fmtSize(total)}`);
      }
    }
    if (batch.length) await putEntries(db, batch);
    bar.value = total;
  } catch (e) {
    setStatus(status, `A instalação falhou em ${fmtSize(written)}: ${e.message || e}`, "bad");
    done(true);
    return;
  } finally {
    db?.close();
  }

  const installed = await installedFiles();
  const lost = REQUIRED.filter((f) => !installed.has(f));
  if (lost.length) {
    setStatus(status, "Instalação incompleta, faltando: " + lost.join(", "), "bad");
    done(true);
    return;
  }
  setStatus(status, `Instalado: ${files.length} arquivos (${fmtSize(total)}). Não precisa repetir neste navegador.`, "ok");
  done(false);
  setInstalled(true);
}

function setInstalled(yes) {
  $("launch").disabled = !yes;
  $("remove").hidden = !yes;
}

// --- Jogar -------------------------------------------------------------------

function selectedRuntime() {
  return document.querySelector('input[name="runtime"]:checked').value;
}

function launchUrl() {
  const params = new URLSearchParams({
    root: ROOT_FS,
    storage: "indexeddb",
    storageKey: STORAGE_KEY,
    p: "USARacer.exe",
    w: "d:/",
    sound: "true",
    bpp: "32",
    resolution: "640x480",
  });
  return `runtime/${selectedRuntime()}/boxedwine.html?${params}`;
}

function updateLaunchUrl() {
  $("launch-url").textContent = new URL(launchUrl(), location.href).href;
}

// --- Ligações ----------------------------------------------------------------

checkSupport();
const canIsolate = "serviceWorker" in navigator && window.isSecureContext;
$(canIsolate ? "rt-mt" : "rt-st").checked = true;
$("rt-mt").disabled = !canIsolate;
for (const r of document.querySelectorAll('input[name="runtime"]')) r.addEventListener("change", updateLaunchUrl);
updateLaunchUrl();

$("pick-zip").addEventListener("click", () => $("zip-input").click());
$("pick-folder").addEventListener("click", () => $("folder-input").click());
$("zip-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  setStatus($("source-status"), "Lendo o zip...");
  try {
    await checkSource(await readZip(file));
  } catch (err) {
    setStatus($("source-status"), "Não consegui ler o zip: " + (err.message || err), "bad");
  }
});
$("folder-input").addEventListener("change", async (e) => {
  if (!e.target.files.length) return;
  setStatus($("source-status"), "Lendo a pasta...");
  await checkSource(fromFileList(e.target.files));
});
$("install").addEventListener("click", install);
$("launch").addEventListener("click", () => { location.href = launchUrl(); });
$("remove").addEventListener("click", async () => {
  try {
    await removeInstalled();
    setInstalled(false);
    setStatus($("install-status"), "Removido deste navegador (os saves junto).", "warn");
  } catch (e) {
    setStatus($("install-status"), "Não consegui remover: " + e.message, "bad");
  }
});

// Mostra os logs que o jogo grava no D: (motivo de erros como "abnormal program termination").
async function readDriveText(db, name) {
  const tx = db.transaction(IDB_STORE, "readonly");
  const store = tx.objectStore(IDB_STORE);
  const keys = await new Promise((r) => { const q = store.getAllKeys(); q.onsuccess = () => r(q.result); });
  const key = keys.find((k) => String(k).toLowerCase() === (D_DRIVE + "/" + name).toLowerCase());
  if (!key) return null;
  const entry = await new Promise((r) => { const q = store.get(key); q.onsuccess = () => r(q.result); });
  return entry && entry.contents ? entry : null;
}
$("show-log").addEventListener("click", async () => {
  const out = $("game-log");
  out.hidden = false;
  out.textContent = "Lendo...";
  let db;
  try {
    db = await openDrive();
    const parts = [];
    const exe = await readDriveText(db, "USARacer.exe");
    if (exe) parts.push("USARacer.exe instalado: " + (await sha256(exe.contents)) + (EXE_PATCHED === (await sha256(exe.contents)) ? " (versão atual)" : " (VERSÃO ANTIGA: remova e instale de novo)"));
    for (const name of ["ErrorUS Racer00.log", "DebugUS Racer00.log"]) {
      const e = await readDriveText(db, name);
      const text = e ? new TextDecoder("latin1").decode(e.contents).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n") : "(não existe ainda)";
      parts.push("===== " + name + " =====\n" + text.slice(-6000));
    }
    out.textContent = parts.join("\n\n");
  } catch (e) {
    out.textContent = "Não consegui ler: " + (e.message || e);
  } finally {
    db?.close();
  }
});

isInstalled().then((yes) => {
  setInstalled(yes);
  if (yes) setStatus($("install-status"), "Já instalado neste navegador. Pode ir direto para o passo 3.", "ok");
});
