# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Snippet Manager

App Electron desktop pra gerenciar snippets de código com persistência em SQLite embarcado (via `better-sqlite3`).

## Comandos

- `npm install` — instala dependências. `better-sqlite3` é módulo nativo; Electron Forge tem `rebuildConfig` + `plugin-auto-unpack-natives` configurados, então rebuild para Electron acontece automaticamente.
- `npm start` — roda o app via `electron-forge start`. Sem dependência externa de banco — SQLite vive em `<userData>/snippet-manager.db`.
- `npm run lint` / `npm run lint:fix` — ESLint flat config; arquivos têm rulesets diferentes pra main/preload (Node) e renderer (browser + globais CDN)
- `npm run format` / `npm run format:check` — Prettier
- `npm run package` — empacota sem instalador
- `npm run make` — gera instaladores (Squirrel/Windows, deb, rpm, zip pra darwin) via Electron Forge
- Não há suíte de testes configurada

## Persistência (runtime)

SQLite arquivo único em `<userData>/snippet-manager.db`. `initDB()` cria schema idempotentemente:

- **`snippets`** (id TEXT PK, title, language, tags, code, created, updated) — IDs em hex 24-char gerados via `crypto.randomBytes(12).toString('hex')`.
- **`images`** (id PK, snippet_id FK CASCADE, file_name, title, uploaded) — antes embedded array, agora tabela normalizada.
- **`users`** (id, username UNIQUE, password_hash, created).
- **`snippets_fts`** (virtual FTS5 com `tokenize='unicode61 remove_diacritics 2'`, `content='snippets'` external content). Sincronizada por triggers AFTER INSERT/UPDATE/DELETE.

Pragmas: `journal_mode = WAL` (melhor concorrência) e `foreign_keys = ON` (cascade no delete de snippets remove imagens).

## Busca

`snippets:list(query)` usa FTS5 quando há query. `toFtsQuery()` quebra o input em tokens (split por não-alfanumérico via regex unicode-aware), adiciona `*` em cada (prefix match). Resultado: busca substring-like — `"java"` → `java*` casa `java`, `javascript`, `JavaServer`. Múltiplas palavras viram AND implícito.

Caracteres especiais (`-_.`/etc) são separadores: `"react-native"` → `react* native*` (AND). Acentos são normalizados pelo `remove_diacritics`: `"código"` casa `"codigo"`.

Ordenação: por `rank` (relevância FTS5) quando há query; por `created DESC` quando não.

## Arquitetura

Três processos isolados via `contextIsolation: true` + `nodeIntegration: false`:

- [main.js](main.js): inicializa SQLite, registra IPC handlers `snippets:list|get|create|update|delete|meta`, `images:upload|upload-buffer|rename|delete`, `auth:login|logout`, `clipboard:write`, `get-images-path`, `select-images`, `get-config|save-config`, `select-folder`, `reset-config-path`. `update` ignora `id`/`_id`/`created` no payload e sempre seta `updated: ISO string now`.
- [preload.js](preload.js): expõe `window.api` no renderer. `copyToClipboard` é roteado via IPC (não `clipboard` direto — sandbox restringe). Listener `onImagePathChanged` propaga mudança da pasta de imagens.
- [renderer.js](renderer.js): UI single-page. Busca é debounceada (500ms) e fetchada do backend com sequence-number rejection (stale results descartados). Filtros de linguagem/tag são client-side sobre o resultado do backend.
- [index.html](index.html) carrega highlight.js, marked e DOMPurify por CDN — declarados como globais readonly no [eslint.config.js](eslint.config.js).

### Lazy-loading do code

`snippets:list` retorna projection leve **sem o campo `code`** (só metadados + array de imagens). `snippets:get(id)` busca o doc completo. No renderer, `select(id)` checa `s.code === undefined` e, se faltando, chama `getSnippet`. Race protection via `currentId === id` antes de aplicar resultado.

### Fluxo de edição

`updateCurrent()` é disparado em cada `input`/`change`, atualiza o objeto em memória, re-renderiza a lista, e agenda duas timeouts independentes:

- preview: 150ms (`schedulePreviewUpdate`)
- persistência: 400ms (`scheduleSave` chama `updateSnippet` IPC)

Não há lock/versioning — última escrita ganha. Se mudar o debounce, ajustar nos dois lugares.

### View modes e markdown

O `#editor` recebe uma das classes `view-editor` / `view-split` / `view-preview` que controlam visibilidade via CSS de `#code` (textarea), `.preview` (highlight.js) e `.rendered-md` (markdown). Quando `language === 'markdown'`, adiciona também `.markdown-mode` que troca qual painel de preview aparece. Pipeline markdown: `marked.parse` (com `breaks: true, gfm: true`) → `DOMPurify.sanitize` → `hljs.highlightElement` em cada `pre code` (sempre apaga `dataset.highlighted` antes pra forçar re-highlight).

## Convenções

- Renderer acessa dados só via `window.api.*` → IPC. Sem cliente SQLite no renderer.
- IDs cruzam o bridge sempre como string em campo `id` (24-char hex). Validação leve no backend — `id` é tratado como opaque pelo renderer.
- Campo `language` no documento = linguagem de programação (input do `<select>`).
- ESLint trata main.js+preload.js como CommonJS Node e renderer.js como script browser — não misturar (ex.: não usar `require` no renderer).
- Tags são string vírgula-separada (split + trim + lowercase pra canonicalização nos filtros).

## Empacotamento

[forge.config.js](forge.config.js) aplica fuses de segurança no build: `RunAsNode: false`, `EnableNodeOptionsEnvironmentVariable: false`, `EnableNodeCliInspectArguments: false`, `EnableEmbeddedAsarIntegrityValidation: true`, `OnlyLoadAppFromAsar: true`, `EnableCookieEncryption: true`. Mexer nessas flags afeta o que builds empacotados conseguem fazer em runtime.

`plugin-auto-unpack-natives` desempacota `better-sqlite3` pro asar (módulos nativos não podem rodar de dentro do asar). `rebuildConfig: {}` ativa rebuild automático na hora do install/package.

## Publish + auto-update (GitHub Releases)

Auto-update funciona via [update.electronjs.org](https://update.electronjs.org) — serviço gratuito hospedado pela Electron team que serve metadata de update direto do GitHub Releases do repo `maper765/snippet-manager` (precisa ser **público**).

### Como publicar uma nova versão

1. **Bump da versão** em `package.json` (semver, ex.: `1.0.0` → `1.0.1`). O updater compara via essa string — sem bump não há update.
2. **Gerar/exportar PAT** com scope `repo` em [github.com/settings/tokens](https://github.com/settings/tokens) e setar:

   ```powershell
   $env:GITHUB_TOKEN = "ghp_..."
   ```

3. **Rodar publish**:

   ```powershell
   npm run publish
   ```

   Isso roda `electron-forge publish`: empacota, gera instaladores (Squirrel/.deb/.rpm/.zip) e faz upload pro GitHub Releases como **draft**.
4. **Revisar e publicar manualmente** em github.com/maper765/snippet-manager/releases — o publisher cria draft (config `draft: true` em forge.config.js); precisa clicar em "Publish release" pra ficar visível pros usuários.
5. **Clientes existentes** vão detectar o update em até 1 hora (interval configurado em [main.js](main.js)) e mostrar diálogo "Restart to apply".

### Quem checa update

`update-electron-app` só roda se `app.isPackaged === true` — em dev (`npm start`) o updater fica desabilitado, evitando ruído de "no update available" no log.

Plataformas suportadas pelo update.electronjs.org:

- **Windows**: ok via Squirrel (sem code signing dispara SmartScreen warning no primeiro install, mas updates depois funcionam silenciosos).
- **macOS**: precisa de code signing (Apple Developer ID), senão o Gatekeeper bloqueia.
- **Linux**: não suportado pelo update.electronjs.org. Usuários precisariam reinstalar manualmente.
