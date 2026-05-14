const { app, BrowserWindow, ipcMain, Menu, dialog, clipboard, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const Database = require('better-sqlite3');

// Auto-update via update.electronjs.org (somente em build empacotada)
if (app.isPackaged) {
  try {
    const { updateElectronApp, UpdateSourceType } = require('update-electron-app');
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: 'maper765/snippet-manager'
      },
      updateInterval: '1 hour',
      logger: console
    });
  } catch (err) {
    console.error('Falha ao iniciar auto-update:', err.message);
  }
}

const DB_FILE = path.join(app.getPath('userData'), 'snippet-manager.db');
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_IMAGES_DIR = path.join(app.getPath('userData'), 'images');

let IMAGES_DIR = DEFAULT_IMAGES_DIR;
let CONFIG = {};
let db;
let mainWindow;

// ----- Config (userData/config.json) -----

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) || {};
    }
  } catch (err) {
    console.error('Erro ao carregar config:', err.message);
    CONFIG = {};
  }

  if (CONFIG.imagePath && fs.existsSync(CONFIG.imagePath)) {
    IMAGES_DIR = CONFIG.imagePath;
    console.log(`Pasta de imagens configurada: ${IMAGES_DIR}`);
  } else {
    IMAGES_DIR = DEFAULT_IMAGES_DIR;
    console.log(`Usando pasta padrão de imagens: ${IMAGES_DIR}`);
  }
}

function saveConfig(partial) {
  try {
    CONFIG = { ...CONFIG, ...partial };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar config:', err.message);
    throw err;
  }
}

function checkWritable(dirPath) {
  const testFile = path.join(dirPath, `.write-test-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
    return true;
  } catch {
    return false;
  }
}

function listImageFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  try {
    return fs.readdirSync(dirPath).filter((name) => {
      if (name.startsWith('.')) return false;
      try {
        return fs.statSync(path.join(dirPath, name)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function migrateImages(oldPath, newPath, mode, files) {
  let migrated = 0;
  let skipped = 0;
  const errors = [];

  for (const file of files) {
    const src = path.join(oldPath, file);
    const dst = path.join(newPath, file);

    try {
      if (fs.existsSync(dst)) {
        skipped++;
        continue;
      }

      if (mode === 'move') {
        try {
          fs.renameSync(src, dst);
        } catch (err) {
          if (err.code === 'EXDEV') {
            fs.copyFileSync(src, dst);
            fs.unlinkSync(src);
          } else {
            throw err;
          }
        }
      } else {
        fs.copyFileSync(src, dst);
      }
      migrated++;
    } catch (err) {
      errors.push({ file, error: err.message });
    }
  }

  return { mode, migrated, skipped, errors };
}

async function askMigration(parentWindow, oldPath, newPath, count) {
  const result = await dialog.showMessageBox(parentWindow ?? mainWindow, {
    type: 'question',
    buttons: ['Mover', 'Copiar', 'Deixar onde está', 'Cancelar'],
    defaultId: 0,
    cancelId: 3,
    title: 'Imagens existentes',
    message: `Foram encontradas ${count} imagem(ns) na pasta atual.`,
    detail: `O que deseja fazer com as imagens?\n\nPasta atual:\n${oldPath}\n\nNova pasta:\n${newPath}\n\nMover: transfere os arquivos para a nova pasta.\nCopiar: duplica os arquivos.\nDeixar onde está: snippets que referenciam essas imagens podem quebrar.`
  });
  return ['move', 'copy', 'leave', 'cancel'][result.response] ?? 'cancel';
}

async function applyImagePath(newPath, parentWindow) {
  if (!newPath) throw new Error('Caminho não pode estar vazio');

  if (!fs.existsSync(newPath)) {
    try {
      fs.mkdirSync(newPath, { recursive: true });
    } catch (err) {
      throw new Error(`Não foi possível criar a pasta: ${err.message}`);
    }
  }

  const stat = fs.statSync(newPath);
  if (!stat.isDirectory()) {
    throw new Error('O caminho selecionado não é uma pasta');
  }

  if (!checkWritable(newPath)) {
    throw new Error('Sem permissão de escrita na pasta selecionada');
  }

  const oldPath = IMAGES_DIR;
  const sameDir = path.resolve(oldPath) === path.resolve(newPath);

  let migration = null;
  if (!sameDir) {
    const files = listImageFiles(oldPath);
    if (files.length > 0) {
      const choice = await askMigration(parentWindow, oldPath, newPath, files.length);
      if (choice === 'cancel') {
        return { imagePath: oldPath, cancelled: true };
      }
      if (choice === 'move' || choice === 'copy') {
        migration = migrateImages(oldPath, newPath, choice, files);
      }
    }
  }

  saveConfig({ imagePath: newPath });
  IMAGES_DIR = newPath;
  console.log(`Pasta de imagens atualizada: ${IMAGES_DIR}`);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('config:imagePath-changed', IMAGES_DIR);
  }

  return { imagePath: IMAGES_DIR, migration, cancelled: false };
}

// ----- SQLite -----

function initDB() {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'javascript',
      tags TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snippets_created ON snippets(created DESC);
    CREATE INDEX IF NOT EXISTS idx_snippets_language ON snippets(language);

    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      snippet_id TEXT NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      uploaded TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_images_snippet ON images(snippet_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts USING fts5(
      title, code, tags,
      content='snippets',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS snippets_ai AFTER INSERT ON snippets BEGIN
      INSERT INTO snippets_fts(rowid, title, code, tags)
      VALUES (new.rowid, new.title, new.code, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS snippets_ad AFTER DELETE ON snippets BEGIN
      INSERT INTO snippets_fts(snippets_fts, rowid, title, code, tags)
      VALUES ('delete', old.rowid, old.title, old.code, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS snippets_au AFTER UPDATE ON snippets BEGIN
      INSERT INTO snippets_fts(snippets_fts, rowid, title, code, tags)
      VALUES ('delete', old.rowid, old.title, old.code, old.tags);
      INSERT INTO snippets_fts(rowid, title, code, tags)
      VALUES (new.rowid, new.title, new.code, new.tags);
    END;
  `);

  console.log(`SQLite conectado: ${DB_FILE}`);
  console.log(`Diretório de imagens: ${IMAGES_DIR}`);
}

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function getImagesForSnippet(snippetId) {
  return db
    .prepare(
      `SELECT id, file_name AS fileName, title, uploaded
       FROM images WHERE snippet_id = ? ORDER BY uploaded ASC`
    )
    .all(snippetId);
}

function attachImagesBatch(rows) {
  if (rows.length === 0) return;
  const placeholders = rows.map(() => '?').join(',');
  const all = db
    .prepare(
      `SELECT id, snippet_id AS snippetId, file_name AS fileName, title, uploaded
       FROM images WHERE snippet_id IN (${placeholders}) ORDER BY uploaded ASC`
    )
    .all(...rows.map((r) => r.id));

  const grouped = new Map();
  for (const img of all) {
    if (!grouped.has(img.snippetId)) grouped.set(img.snippetId, []);
    grouped.get(img.snippetId).push({
      id: img.id,
      fileName: img.fileName,
      title: img.title,
      uploaded: img.uploaded
    });
  }
  for (const r of rows) {
    r.images = grouped.get(r.id) || [];
  }
}

// Quebra a query do usuário em tokens "seguros" pra FTS5 e adiciona prefix
// match (ex.: "java" → "java*" → casa "java" e "javascript")
function toFtsQuery(input) {
  const tokens = String(input)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((tok) => tok.length > 0);
  if (!tokens.length) return null;
  return tokens.map((tok) => `${tok}*`).join(' ');
}

// ----- Janelas -----

function createWindow() {
  const stored = CONFIG.windowBounds || {};
  const opts = {
    width: Number.isInteger(stored.width) ? stored.width : 1200,
    height: Number.isInteger(stored.height) ? stored.height : 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  };
  if (Number.isInteger(stored.x) && Number.isInteger(stored.y)) {
    opts.x = stored.x;
    opts.y = stored.y;
  }

  mainWindow = new BrowserWindow(opts);
  if (stored.maximized) mainWindow.maximize();
  mainWindow.loadFile('index.html');

  let lastNormalBounds = Number.isInteger(stored.width)
    ? { x: stored.x, y: stored.y, width: stored.width, height: stored.height }
    : null;
  let persistTimer = null;
  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const maximized = mainWindow.isMaximized();
      if (!maximized) {
        lastNormalBounds = mainWindow.getBounds();
      }
      try {
        saveConfig({
          windowBounds: { maximized, ...(lastNormalBounds || {}) }
        });
      } catch (err) {
        console.error('Erro ao persistir bounds:', err.message);
      }
    }, 400);
  };

  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);
  mainWindow.on('maximize', persistBounds);
  mainWindow.on('unmaximize', persistBounds);
  mainWindow.on('close', () => {
    clearTimeout(persistTimer);
    if (mainWindow && !mainWindow.isDestroyed()) {
      const maximized = mainWindow.isMaximized();
      if (!maximized) lastNormalBounds = mainWindow.getBounds();
      try {
        saveConfig({
          windowBounds: { maximized, ...(lastNormalBounds || {}) }
        });
      } catch {
        // ignore on shutdown
      }
    }
  });
}

function createAboutWindow() {
  const aboutWin = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    width: 620,
    height: 720,
    resizable: true,
    minimizable: false,
    maximizable: false,
    title: 'Sobre o Snippet Manager',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  aboutWin.removeMenu();
  aboutWin.loadFile('about.html', { query: { version: app.getVersion() } });
}

function createConfigWindow() {
  const configWin = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    width: 560,
    height: 500,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Configurações',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  configWin.removeMenu();
  configWin.loadFile('config.html');
}

// ----- Export pra JSON -----

async function exportSnippets() {
  if (!db) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Exportar snippets',
      message: 'Banco de dados não conectado.'
    });
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar snippets',
    defaultPath: `snippets-${stamp}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return;

  try {
    const rows = db
      .prepare(
        `SELECT id, title, language, tags, code, created, updated
         FROM snippets ORDER BY created DESC`
      )
      .all();
    attachImagesBatch(rows);

    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      count: rows.length,
      snippets: rows
    };
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Exportação concluída',
      message: `${rows.length} snippet(s) exportado(s).`,
      detail: `Arquivo salvo em:\n${result.filePath}`
    });
  } catch (err) {
    console.error('Erro ao exportar:', err);
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Erro ao exportar',
      message: err.message
    });
  }
}

// ----- Menu -----

function createMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }]
          }
        ]
      : []),
    {
      label: 'Configurações',
      submenu: [
        {
          label: 'Preferências...',
          click: () => createConfigWindow()
        },
        { type: 'separator' },
        {
          label: 'Exportar snippets...',
          accelerator: 'CmdOrCtrl+E',
          click: () => exportSnippets()
        }
      ]
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        {
          label: 'About Snippet Manager',
          click: () => createAboutWindow()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ----- App lifecycle -----

app.whenReady().then(() => {
  loadConfig();
  createMenu();
  try {
    initDB();
  } catch (err) {
    console.error('Erro ao iniciar SQLite:', err.message);
  }

  ipcMain.handle('snippets:list', (_, query) => {
    if (!db) throw new Error('SQLite não conectado');
    const trimmed = typeof query === 'string' ? query.trim() : '';

    let rows;
    if (trimmed) {
      const fts = toFtsQuery(trimmed);
      if (fts) {
        try {
          rows = db
            .prepare(
              `SELECT s.id, s.title, s.language, s.tags, s.created, s.updated
               FROM snippets s
               JOIN snippets_fts fts ON fts.rowid = s.rowid
               WHERE snippets_fts MATCH ?
               ORDER BY rank`
            )
            .all(fts);
        } catch (err) {
          console.warn('FTS query falhou, retornando tudo:', err.message);
          rows = null;
        }
      }
      if (!rows) {
        rows = db
          .prepare(
            `SELECT id, title, language, tags, created, updated
             FROM snippets ORDER BY created DESC`
          )
          .all();
      }
    } else {
      rows = db
        .prepare(
          `SELECT id, title, language, tags, created, updated
           FROM snippets ORDER BY created DESC`
        )
        .all();
    }

    attachImagesBatch(rows);
    return rows;
  });

  ipcMain.handle('snippets:get', (_, id) => {
    if (!db) throw new Error('SQLite não conectado');
    const row = db
      .prepare(
        `SELECT id, title, language, tags, code, created, updated
         FROM snippets WHERE id = ?`
      )
      .get(id);
    if (!row) return null;
    row.images = getImagesForSnippet(id);
    return row;
  });

  ipcMain.handle('snippets:meta', () => {
    if (!db) throw new Error('SQLite não conectado');
    const count = db.prepare('SELECT COUNT(*) AS c FROM snippets').get().c;
    const languages = db
      .prepare(
        `SELECT DISTINCT language FROM snippets
         WHERE language != '' ORDER BY language`
      )
      .all()
      .map((r) => r.language);

    const tagRows = db.prepare(`SELECT tags FROM snippets WHERE tags != ''`).all();
    const tagSet = new Set();
    for (const r of tagRows) {
      for (const raw of r.tags.split(',')) {
        const t = raw.trim().toLowerCase();
        if (t) tagSet.add(t);
      }
    }
    return { count, languages, tags: [...tagSet].sort() };
  });

  ipcMain.handle('snippets:create', (_, data) => {
    if (!db) throw new Error('SQLite não conectado');
    const id = newId();
    const now = new Date().toISOString();
    const doc = {
      id,
      title: data?.title || 'Novo snippet',
      language: data?.language || 'javascript',
      tags: data?.tags || '',
      code: data?.code || '',
      created: now,
      updated: now,
      images: []
    };
    db.prepare(
      `INSERT INTO snippets (id, title, language, tags, code, created, updated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(doc.id, doc.title, doc.language, doc.tags, doc.code, doc.created, doc.updated);
    return doc;
  });

  ipcMain.handle('snippets:update', (_, id, fields) => {
    if (!db) throw new Error('SQLite não conectado');
    const allowed = ['title', 'language', 'tags', 'code'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (fields && key in fields) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    const now = new Date().toISOString();
    sets.push('updated = ?');
    params.push(now);
    params.push(id);

    db.prepare(`UPDATE snippets SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    const row = db
      .prepare(
        `SELECT id, title, language, tags, code, created, updated
         FROM snippets WHERE id = ?`
      )
      .get(id);
    if (!row) return null;
    row.images = getImagesForSnippet(id);
    return row;
  });

  ipcMain.handle('snippets:delete', (_, id) => {
    if (!db) throw new Error('SQLite não conectado');
    const imgs = getImagesForSnippet(id);
    db.prepare('DELETE FROM snippets WHERE id = ?').run(id);
    for (const img of imgs) {
      const fp = path.join(IMAGES_DIR, img.fileName);
      try {
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch (err) {
        console.warn('Falha ao remover imagem do disco:', img.fileName, err.message);
      }
    }
    return true;
  });

  ipcMain.handle('clipboard:write', (_, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });

  ipcMain.handle('app:quit', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('images:upload', (_, snippetId, filePath, title) => {
    if (!db) throw new Error('SQLite não conectado');
    if (!fs.existsSync(filePath)) throw new Error('Arquivo não encontrado');

    const imageId = newId();
    const ext = path.extname(filePath);
    const fileName = `${imageId}${ext}`;
    const destPath = path.join(IMAGES_DIR, fileName);
    fs.copyFileSync(filePath, destPath);

    const defaultTitle = path.basename(filePath, ext);
    const finalTitle =
      typeof title === 'string' && title.trim() ? title.trim() : defaultTitle;

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO images (id, snippet_id, file_name, title, uploaded)
       VALUES (?, ?, ?, ?, ?)`
    ).run(imageId, snippetId, fileName, finalTitle, now);
    db.prepare('UPDATE snippets SET updated = ? WHERE id = ?').run(now, snippetId);

    const row = db
      .prepare(
        `SELECT id, title, language, tags, code, created, updated
         FROM snippets WHERE id = ?`
      )
      .get(snippetId);
    if (!row) return null;
    row.images = getImagesForSnippet(snippetId);
    return row;
  });

  ipcMain.handle('images:upload-buffer', async (_, snippetId, bytes, ext, title) => {
    if (!db) throw new Error('SQLite não conectado');
    if (!bytes) throw new Error('Buffer vazio');

    let safeExt = String(ext || '.png').toLowerCase().replace(/[^a-z0-9.]/g, '');
    if (!safeExt.startsWith('.')) safeExt = '.' + safeExt;
    if (!/^\.[a-z0-9]+$/.test(safeExt)) safeExt = '.png';

    const imageId = newId();
    const fileName = `${imageId}${safeExt}`;
    const destPath = path.join(IMAGES_DIR, fileName);

    if (!fs.existsSync(IMAGES_DIR)) {
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
    }
    await fs.promises.writeFile(destPath, Buffer.from(bytes));

    const cleanTitle =
      typeof title === 'string' && title.trim()
        ? title.trim()
        : `Imagem colada ${new Date().toLocaleString('pt-BR')}`;

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO images (id, snippet_id, file_name, title, uploaded)
       VALUES (?, ?, ?, ?, ?)`
    ).run(imageId, snippetId, fileName, cleanTitle, now);
    db.prepare('UPDATE snippets SET updated = ? WHERE id = ?').run(now, snippetId);

    const row = db
      .prepare(
        `SELECT id, title, language, tags, code, created, updated
         FROM snippets WHERE id = ?`
      )
      .get(snippetId);
    if (!row) return null;
    row.images = getImagesForSnippet(snippetId);
    return row;
  });

  ipcMain.handle('images:rename', (_, snippetId, imageId, title) => {
    if (!db) throw new Error('SQLite não conectado');
    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    const result = db
      .prepare(`UPDATE images SET title = ? WHERE id = ? AND snippet_id = ?`)
      .run(cleanTitle, imageId, snippetId);
    if (result.changes === 0) throw new Error('Imagem não encontrada');

    const now = new Date().toISOString();
    db.prepare('UPDATE snippets SET updated = ? WHERE id = ?').run(now, snippetId);

    const row = db
      .prepare(
        `SELECT id, title, language, tags, code, created, updated
         FROM snippets WHERE id = ?`
      )
      .get(snippetId);
    if (!row) return null;
    row.images = getImagesForSnippet(snippetId);
    return row;
  });

  ipcMain.handle('images:delete', (_, snippetId, imageId) => {
    if (!db) throw new Error('SQLite não conectado');
    const img = db
      .prepare(`SELECT file_name AS fileName FROM images WHERE id = ? AND snippet_id = ?`)
      .get(imageId, snippetId);
    if (!img) throw new Error('Imagem não encontrada');

    const filePath = path.join(IMAGES_DIR, img.fileName);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn('Falha ao remover arquivo:', err.message);
      }
    }

    db.prepare('DELETE FROM images WHERE id = ? AND snippet_id = ?').run(imageId, snippetId);

    const now = new Date().toISOString();
    db.prepare('UPDATE snippets SET updated = ? WHERE id = ?').run(now, snippetId);

    const row = db
      .prepare(
        `SELECT id, title, language, tags, code, created, updated
         FROM snippets WHERE id = ?`
      )
      .get(snippetId);
    if (!row) return null;
    row.images = getImagesForSnippet(snippetId);
    return row;
  });

  ipcMain.handle('get-images-path', () => IMAGES_DIR);

  ipcMain.handle('select-images', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    });
    return result.filePaths;
  });

  ipcMain.handle('get-config', () => {
    return { imagePath: IMAGES_DIR, dbPath: DB_FILE };
  });

  ipcMain.handle('shell:show-in-folder', (_, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    }
    return true;
  });

  ipcMain.handle('save-config', async (event, config) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    return applyImagePath(config?.imagePath, parent);
  });

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('reset-config-path', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = await applyImagePath(DEFAULT_IMAGES_DIR, parent);
    return result.imagePath;
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  if (process.platform !== 'darwin') app.quit();
});
