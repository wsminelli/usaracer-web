# Licenças e créditos

Este repositório contém só o launcher e os scripts de compilação. Ele não
contém código nem dados do US Racer. Os arquivos do jogo vêm da cópia do
próprio jogador, escolhida no navegador, e não saem do computador dele.

| Componente | Licença | Fonte |
|---|---|---|
| Launcher e scripts deste repositório | MIT | este repositório; estrutura adaptada de https://github.com/HarshitPeriwal/spiderman-2000-browser (MIT) |
| Boxedwine (emulação x86, JIT WASM, shell do navegador) | GPL-2.0-or-later | https://github.com/danoon2/Boxedwine, commit `8ab37e7b79737467674b40fe0675396b3d90a469` |
| Sistema de arquivos Wine 11.0 `TinyCore15Wine11.0-web.zip` v23, com os patches WebGL do WineD3D | LGPL-2.1-or-later (Wine); componentes do TinyCore Linux sob suas próprias licenças | https://boxedwine.org/v2/23/TinyCore15Wine11.0-web.zip, patches em `tools/d3dToWebGL/` do Boxedwine |
| coi-serviceworker | MIT | https://github.com/gzuidhof/coi-serviceworker |
| Runtime do Emscripten | MIT / University of Illinois NCSA | https://github.com/emscripten-core/emscripten |

O site publica o Boxedwine e o sistema de arquivos do Wine sem modificação. O
código-fonte correspondente está nos links acima, no commit e na versão fixados.

US Racer (A2 Racer Goes USA!) é marca da Davilex. Este projeto não tem relação
com a Davilex.
