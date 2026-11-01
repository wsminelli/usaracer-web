# US Racer no navegador

Roda o **US Racer / A2 Racer Goes USA!** (Davilex, 2001, Windows) dentro do
navegador. Não é um port: o `USARacer.exe` original roda sobre o
[Boxedwine](https://github.com/danoon2/Boxedwine) (Wine + emulador x86
compilados para WebAssembly), que converte o Direct3D 7 do jogo em WebGL.

Este repositório tem só o site (launcher) e o script que compila o Boxedwine.
O jogo em si fica fora: cada jogador escolhe o `USARacer-jogo.zip` no próprio
navegador, e os arquivos são gravados no armazenamento local dele.

## O que tem aqui

| Caminho | Para que serve |
|---|---|
| `site/index.html`, `site/launcher.js` | Página que lê o jogo (zip ou pasta), instala no IndexedDB como drive `D:` e abre o Boxedwine |
| `scripts/build-runtime.sh` | Compila o Boxedwine (JIT WASM, thread única e multi-thread), baixa o Wine 11 web e monta `dist/` |
| `scripts/serve.mjs` | Servidor local com os cabeçalhos COOP/COEP |
| `.github/workflows/pages.yml` | Compila e publica tudo no GitHub Pages a cada push |

## Caminho 1: GitHub Pages (sem instalar nada no PC)

1. Crie uma conta no GitHub (se ainda não tiver) e um repositório novo, por
   exemplo `usaracer-web`. Pode ser público ou privado (Pages em repositório
   privado exige plano pago).
2. Envie o conteúdo desta pasta para o repositório (botão **Add file → Upload
   files**, arrastando tudo, inclusive a pasta `.github`). **Não envie o jogo.**
3. Em **Settings → Pages**, em *Build and deployment → Source*, escolha
   **GitHub Actions**.
4. Em **Actions**, rode o workflow *Compilar e publicar no GitHub Pages* (ele
   também roda sozinho a cada push). A primeira compilação leva uns 30 a 60
   minutos; as seguintes usam cache.
5. Quando terminar, o endereço aparece no próprio workflow:
   `https://SEU-USUARIO.github.io/usaracer-web/`.

## Caminho 2: no próprio PC (Linux ou WSL no Windows)

```bash
bash scripts/build-runtime.sh        # 20-40 min na primeira vez
node scripts/serve.mjs 8080 dist     # depois abra http://localhost:8080/
```

No Windows, instale o WSL (`wsl --install` no PowerShell como administrador),
abra o Ubuntu e rode os comandos acima dentro desta pasta. Precisa de
`git python3 curl make nodejs` (`sudo apt install git python3 curl make nodejs`).

## Jogando

1. Abra o site no **Chrome ou Edge** (137 ou mais novo) ou Firefox 131+.
2. **Escolher o .zip** → selecione `USARacer-jogo.zip`.
3. **Instalar** (copia ~265 MB para o navegador; só na primeira vez).
4. **Jogar**. A primeira carga do emulador baixa ~100 MB. Clique na tela do
   jogo uma vez para liberar teclado e som.
5. Na primeira tela, digite seu nome com o teclado, desça até **OK** com
   <kbd>↓</kbd> e confirme com <kbd>Enter</kbd>.

Os saves ficam no navegador (drive `D:` do Boxedwine). **Remover do
navegador** apaga o jogo e os saves.

## Deixando mais liso

O Boxedwine emula um processador x86 inteiro dentro do navegador, então nunca
fica igual a um PC nativo. O que mais ajuda, em ordem:

1. **Multi-thread com JIT** selecionado (é o padrão no Pages).
2. Desmarcar **Show console** na página do Boxedwine.
3. No jogo, **Options**: qualidade gráfica baixa, sombras e efeitos desligados.
4. Desligar o **Som** no launcher, se ainda engasgar.
5. **Cache do JIT**: os trancos aparecem sempre que o emulador compila código
   novo (início de corrida, pista nova). Dá para gravar esse código compilado:
   - marque *Gravar cache do JIT*, jogue umas corridas em pistas diferentes;
   - clique em **Save JIT Cache** na página do Boxedwine e salve o
     `wasm-jit-modules.zip`;
   - envie ele para `jit-cache/mt/wasm-jit-modules.zip` neste repositório
     (`jit-cache/st/` se gravou no modo thread única). O próximo deploy inclui o
     cache e o jogo já começa com esse código pronto.

## O que foi feito no jogo (`USARacer-jogo.zip`)

- Instalado a partir do ISO original com o instalador Wise do próprio CD
  (pasta `C:\Program Files\Davilex\US Racer`, só inglês).
- `USARacer.exe` trocado pelo executável NoCD que veio junto com o download
  (o do CD tem SafeDisc, que não roda no Wine).
- **Patch de 32 bits** no `USARacer.exe` (4 trechos, 9 bytes). O jogo sempre
  liga o vídeo em 640×480×16 bits, e em 16 bits o DirectDraw do Wine (9 e 11)
  não consegue criar as texturas DXT1 com mipmap: o jogo fecha antes do menu.
  Com o patch ele usa 32 bits, e aceita a tela 640×480×32 (única que o Boxedwine oferece). O launcher também aplica esse patch sozinho se
  receber o exe NoCD sem patch.
- Vídeos de abertura (`Data\Video`, codec MP42) ficam de fora: o Wine não tem
  esse codec e o jogo segue normalmente sem eles.

Esse pacote foi testado no Wine 9.0 (Linux, OpenGL por software) até a corrida
rodando. O Boxedwine no navegador usa Wine 11 com WebGL, que **não pôde ser
testado aqui**: a compilação dele depende de baixar o Emscripten e o sistema
de arquivos do boxedwine.org, que este ambiente não alcança.

## Se algo der errado

| Sintoma | O que tentar |
|---|---|
| Tela preta ou travada ao abrir | Troque para *Thread única com JIT* e jogue de novo |
| "Sound system could not be initialized" | Clique na tela antes do jogo abrir; se persistir, edite `USARacerMain.INI` e ponha `DisableSound=1`, reinstale |
| Muito lento | Use o multi-thread (precisa de https ou localhost) e feche outras abas; o emulador é bem mais lento que um PC nativo |
| Imagem pequena | Use a tela cheia do Boxedwine |
| Quer reinstalar do zero | **Remover do navegador** e instalar de novo |

O console do navegador (<kbd>F12</kbd>) mostra o log do Wine, útil para
diagnosticar.

## Atenção

Não publique o `USARacer-jogo.zip` em lugar nenhum: o jogo continua protegido
por direito autoral. O site publicado pelo Pages não contém o jogo (o script
`build-runtime.sh` aborta se encontrar arquivos dele em `dist/`).
