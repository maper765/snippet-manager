let snippets = [];
let currentId = null;
let saveTimeout = null;
let previewTimeout = null;
let languageFilter = '';
const tagFilters = new Set(); // canonical lowercase
let allLanguages = [];
let allTags = [];
let totalCount = 0;
let searchQuery = '';
let searchDebounce = null;
let searchSeq = 0;
let sortDirection = 'asc'; // 'asc' | 'desc'

const SORT_ICONS = {
  asc: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/></svg>',
  desc: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 16 4 4 4-4"/><path d="M7 4v16"/><path d="M15 4h5l-5 6h5"/><path d="M15 20v-3.5a2.5 2.5 0 0 1 5 0V20"/><path d="M20 18h-5"/></svg>'
};

function updateSortButton() {
  els.sortBtn.innerHTML = SORT_ICONS[sortDirection];
  els.sortBtn.title =
    sortDirection === 'asc'
      ? 'Ordenado A-Z (clique para Z-A)'
      : 'Ordenado Z-A (clique para A-Z)';
}

function toggleSort() {
  sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  updateSortButton();
  renderList();
}

function sortByTitle(arr) {
  return [...arr].sort((a, b) => {
    const t1 = (a.title || '').toLowerCase();
    const t2 = (b.title || '').toLowerCase();
    const cmp = t1.localeCompare(t2, 'pt-BR', { sensitivity: 'base' });
    return sortDirection === 'asc' ? cmp : -cmp;
  });
}

function parseTags(s) {
  return (s.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

async function refreshMeta() {
  try {
    const meta = await window.api.getSnippetsMeta();
    allLanguages = meta.languages || [];
    allTags = meta.tags || [];
    totalCount = meta.count || 0;
  } catch (err) {
    console.error('Falha ao carregar meta:', err);
  }
}

function setSearchingState(active) {
  els.searchWrapper.classList.toggle('searching', active);
  els.list.classList.toggle('searching', active);
}

async function reloadSnippets() {
  const seq = ++searchSeq;
  let result;
  try {
    result = await window.api.listSnippets(searchQuery);
  } catch (err) {
    if (seq !== searchSeq) return;
    console.error('Falha ao buscar snippets:', err);
    snippets = [];
    showStatus('⚠ Erro na busca');
    renderList();
    setSearchingState(false);
    return;
  }
  if (seq !== searchSeq) return; // resultado obsoleto, descarta
  snippets = result;
  renderList();
  setSearchingState(false);
}

function renderLanguageFilter() {
  if (languageFilter && !allLanguages.includes(languageFilter)) {
    languageFilter = '';
  }
  const options =
    '<option value="">Todas as linguagens</option>' +
    allLanguages.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  els.languageFilter.innerHTML = options;
  els.languageFilter.value = languageFilter;
}

function renderTagPicker() {
  const available = allTags.filter((t) => !tagFilters.has(t));
  const options =
    '<option value="">+ Filtrar por tag...</option>' +
    available.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  els.tagPicker.innerHTML = options;
  els.tagPicker.value = '';
}

function renderActiveFilters() {
  const hasAny = !!languageFilter || tagFilters.size > 0;
  if (!hasAny) {
    els.activeFilters.classList.add('hidden');
    els.activeFilters.innerHTML = '';
    return;
  }
  els.activeFilters.classList.remove('hidden');

  const parts = [];
  if (languageFilter) {
    parts.push(
      `<span class="filter-chip lang">${escapeHtml(languageFilter)}<button data-remove-lang="1" title="Remover">×</button></span>`
    );
  }
  for (const t of tagFilters) {
    parts.push(
      `<span class="filter-chip">${escapeHtml(t)}<button data-remove-tag="${escapeHtml(t)}" title="Remover">×</button></span>`
    );
  }
  parts.push('<button class="clear-filters" data-clear="1">Limpar</button>');
  els.activeFilters.innerHTML = parts.join('');

  els.activeFilters.querySelector('[data-remove-lang]')?.addEventListener('click', () => {
    languageFilter = '';
    renderLanguageFilter();
    renderList();
  });
  els.activeFilters.querySelectorAll('[data-remove-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      tagFilters.delete(btn.dataset.removeTag);
      renderTagPicker();
      renderList();
    });
  });
  els.activeFilters.querySelector('[data-clear]')?.addEventListener('click', () => {
    languageFilter = '';
    tagFilters.clear();
    renderLanguageFilter();
    renderTagPicker();
    renderList();
  });
}

function toggleTagFilter(tag) {
  const canon = tag.toLowerCase();
  if (tagFilters.has(canon)) {
    tagFilters.delete(canon);
  } else {
    tagFilters.add(canon);
  }
  renderTagPicker();
  renderList();
}

function toggleLanguageFilter(lang) {
  languageFilter = languageFilter === lang ? '' : lang;
  renderLanguageFilter();
  renderList();
}

function updateSnippetCount(filteredCount) {
  const isFiltered =
    !!languageFilter || tagFilters.size > 0 || searchQuery.length > 0;
  els.snippetCount.textContent = isFiltered ? `${filteredCount} / ${totalCount}` : String(totalCount);
  els.snippetCount.classList.toggle('filtered', isFiltered);
}

const els = {
  appRoot: document.getElementById('appRoot'),
  list: document.getElementById('snippetList'),
  search: document.getElementById('search'),
  sortBtn: document.getElementById('sortBtn'),
  languageFilter: document.getElementById('languageFilter'),
  tagPicker: document.getElementById('tagPicker'),
  activeFilters: document.getElementById('activeFilters'),
  snippetCount: document.getElementById('snippetCount'),
  searchWrapper: document.querySelector('.search-wrapper'),
  newBtn: document.getElementById('newBtn'),
  empty: document.getElementById('empty'),
  editor: document.getElementById('editor'),
  title: document.getElementById('title'),
  language: document.getElementById('language'),
  tags: document.getElementById('tags'),
  code: document.getElementById('code'),
  editorBody: document.querySelector('.editor-body'),
  preview: document.getElementById('preview'),
  rendered: document.getElementById('rendered'),
  gallery: document.getElementById('gallery'),
  copyBtn: document.getElementById('copyBtn'),
  copyEditorPanelBtn: document.getElementById('copyEditorPanelBtn'),
  copyPreviewPanelBtn: document.getElementById('copyPreviewPanelBtn'),
  uploadImageBtn: document.getElementById('uploadImageBtn'),
  deleteBtn: document.getElementById('deleteBtn'),
  status: document.getElementById('status'),
  viewBtns: document.querySelectorAll('.view-toggle button'),
  imageModal: document.getElementById('imageModal'),
  imageModalClose: document.getElementById('imageModalClose'),
  imageModalOverlay: document.querySelector('.image-modal-overlay'),
  imageModalImg: document.getElementById('imageModalImg'),
  imageModalScroll: document.querySelector('.image-modal-scroll'),
  imageModalZoom: document.getElementById('imageModalZoom'),
  imageModalZoomIn: document.getElementById('imageModalZoomIn'),
  imageModalZoomOut: document.getElementById('imageModalZoomOut'),
  imageModalZoomFit: document.getElementById('imageModalZoomFit'),
  imageModalZoomValue: document.getElementById('imageModalZoomValue'),
  quitBtn: document.getElementById('quitBtn'),
  appVersion: document.getElementById('appVersion')
};

let modalFitWidth = 0;
let modalZoom = 100;
const ZOOM_MIN = 25;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function forceSave() {
  clearTimeout(saveTimeout);
  const s = snippets.find((x) => x.id === currentId);
  if (!s) return;
  try {
    await window.api.updateSnippet(s.id, {
      title: s.title,
      language: s.language,
      tags: s.tags,
      code: s.code
    });
    showStatus('Salvo');
  } catch (err) {
    console.error('Falha ao salvar:', err);
    showStatus('⚠ Erro ao salvar');
  }
}

async function duplicateCurrent() {
  const s = snippets.find((x) => x.id === currentId);
  if (!s) return;
  try {
    const novo = await window.api.createSnippet({
      title: `${s.title} (cópia)`,
      language: s.language,
      tags: s.tags,
      code: s.code
    });
    snippets.unshift(novo);
    currentId = novo.id;
    await refreshMeta();
    renderLanguageFilter();
    renderTagPicker();
    renderList();
    await select(novo.id);
    showStatus('Duplicado');
  } catch (err) {
    console.error('Falha ao duplicar:', err);
    showStatus('⚠ Erro ao duplicar');
  }
}

async function uploadDroppedFile(file) {
  if (!file || !file.type.startsWith('image/')) return null;
  const buffer = new Uint8Array(await file.arrayBuffer());
  const mime = file.type || 'image/png';
  const ext = '.' + (mime.split('/')[1] || 'png');
  let title = (file.name || '').replace(/\.[^.]+$/, '');
  if (!title || /^image$/i.test(title)) title = '';
  return window.api.uploadImageBuffer(currentId, buffer, ext, title);
}

function dragHasFiles(dt) {
  return dt && dt.types && Array.from(dt.types).includes('Files');
}

async function handlePasteImage(e) {
  if (els.appRoot.classList.contains('hidden')) return;
  if (!els.imageModal.classList.contains('hidden')) return;
  if (!currentId) return;
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;

  const imageItem = Array.from(items).find(
    (it) => it.kind === 'file' && it.type.startsWith('image/')
  );
  if (!imageItem) return;

  e.preventDefault();
  const file = imageItem.getAsFile();
  if (!file) return;

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const mime = file.type || 'image/png';
    const ext = '.' + (mime.split('/')[1] || 'png');
    let title = (file.name || '').replace(/\.[^.]+$/, '');
    if (!title || /^image$/i.test(title)) title = '';
    const updated = await window.api.uploadImageBuffer(currentId, buffer, ext, title);
    const idx = snippets.findIndex((x) => x.id === currentId);
    if (idx !== -1) snippets[idx] = updated;
    renderGallery();
    showStatus('Imagem colada');
  } catch (err) {
    console.error('Falha ao colar imagem:', err);
    showStatus('⚠ Erro ao colar imagem');
  }
}

async function init() {
  try {
    window.imagePath = await window.api.getImagesPath();
    await refreshMeta();
    snippets = await window.api.listSnippets(searchQuery);
  } catch (err) {
    console.error('Falha ao carregar:', err);
    showStatus('⚠ Banco offline');
    snippets = [];
  }
  window.api
    .getAppVersion()
    .then((v) => {
      if (v) els.appVersion.textContent = `v${v}`;
    })
    .catch((err) => console.error('Falha ao obter versão:', err));
  window.api.onImagePathChanged((newPath) => {
    window.imagePath = newPath;
    if (currentId) renderGallery();
    showStatus('Pasta de imagens atualizada');
  });
  setViewMode('preview');
  renderLanguageFilter();
  renderTagPicker();
  renderList();
}

function renderList() {
  const matched = snippets.filter((s) => {
    if (languageFilter && s.language !== languageFilter) return false;
    if (tagFilters.size > 0) {
      const tags = parseTags(s).map((t) => t.toLowerCase());
      for (const f of tagFilters) {
        if (!tags.includes(f)) return false;
      }
    }
    return true;
  });
  const filtered = sortByTitle(matched);

  els.list.innerHTML = filtered
    .map((s) => {
      const tags = parseTags(s);
      const tagsHtml = tags.length
        ? tags
            .map((t) => {
              const active = tagFilters.has(t.toLowerCase()) ? ' active' : '';
              return `<span class="tag-chip${active}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`;
            })
            .join('')
        : '<span class="tag-empty">sem tags</span>';
      const langActive = languageFilter === s.language ? ' active' : '';
      return `
    <li data-id="${escapeHtml(s.id)}" class="${s.id === currentId ? 'active' : ''}">
      <div class="item-title">${escapeHtml(s.title || 'Sem título')}</div>
      <div class="item-meta">
        <span class="lang-chip${langActive}" data-lang="${escapeHtml(s.language)}">${escapeHtml(s.language)}</span>
        <span class="item-tags">${tagsHtml}</span>
      </div>
    </li>
  `;
    })
    .join('');

  els.list.querySelectorAll('li').forEach((li) => {
    li.addEventListener('click', async (e) => {
      if (e.target.classList.contains('tag-chip')) return;
      if (e.target.classList.contains('lang-chip')) return;
      await select(li.dataset.id);
      setViewMode('preview');
    });
  });

  els.list.querySelectorAll('.tag-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTagFilter(chip.dataset.tag);
    });
  });

  els.list.querySelectorAll('.lang-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLanguageFilter(chip.dataset.lang);
    });
  });

  renderActiveFilters();
  updateSnippetCount(filtered.length);
}

async function select(id) {
  currentId = id;
  const s = snippets.find((x) => x.id === id);
  if (!s) return;
  els.empty.classList.add('hidden');
  els.editor.classList.remove('hidden');
  els.title.value = s.title || '';
  els.language.value = s.language || 'javascript';
  els.tags.value = s.tags || '';

  if (s.code !== undefined) {
    els.code.value = s.code;
    updatePreview();
  } else {
    // Snippet veio "leve" da lista — busca o doc completo
    els.code.value = '';
    els.preview.textContent = '';
    els.rendered.innerHTML = '';
    els.editorBody.classList.add('loading');
    try {
      const full = await window.api.getSnippet(id);
      if (full && currentId === id) {
        const idx = snippets.findIndex((x) => x.id === id);
        if (idx !== -1) snippets[idx] = full;
        els.code.value = full.code || '';
        updatePreview();
      }
    } catch (err) {
      console.error('Falha ao carregar snippet:', err);
      showStatus('⚠ Erro ao carregar snippet');
    } finally {
      if (currentId === id) {
        els.editorBody.classList.remove('loading');
      }
    }
  }

  renderGallery();
  renderList();
}

function updatePreview() {
  const s = snippets.find((x) => x.id === currentId);
  if (!s) return;

  const isMarkdown = s.language === 'markdown';
  els.editor.classList.toggle('markdown-mode', isMarkdown);

  if (isMarkdown) {
    const rawHtml = marked.parse(s.code || '', { breaks: true, gfm: true });
    els.rendered.innerHTML = DOMPurify.sanitize(rawHtml);
    els.rendered.querySelectorAll('pre code').forEach((block) => {
      if (window.hljs) {
        delete block.dataset.highlighted;
        hljs.highlightElement(block);
      }
    });
  } else {
    els.preview.className = `language-${s.language}`;
    els.preview.textContent = s.code;
    if (window.hljs) {
      delete els.preview.dataset.highlighted;
      hljs.highlightElement(els.preview);
    }
  }
}

function schedulePreviewUpdate() {
  clearTimeout(previewTimeout);
  previewTimeout = setTimeout(updatePreview, 150);
}

function setViewMode(mode) {
  els.editor.classList.remove('view-editor', 'view-split', 'view-preview');
  els.editor.classList.add(`view-${mode}`);
  els.viewBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  updatePreview();
}

async function create() {
  try {
    const novo = await window.api.createSnippet({
      title: 'Novo snippet',
      language: 'javascript',
      tags: '',
      code: ''
    });
    snippets.unshift(novo);
    currentId = novo.id;
    await refreshMeta();
    renderLanguageFilter();
    renderTagPicker();
    renderList();
    await select(novo.id);
    setViewMode('editor');
    els.title.focus();
    els.title.select();
    showStatus('Criado');
  } catch (err) {
    console.error('Falha ao criar:', err);
    showStatus('⚠ Erro ao criar');
  }
}

function updateCurrent() {
  const s = snippets.find((x) => x.id === currentId);
  if (!s) return;
  s.title = els.title.value;
  s.language = els.language.value;
  s.tags = els.tags.value;
  s.code = els.code.value;
  renderList();
  schedulePreviewUpdate();
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    const s = snippets.find((x) => x.id === currentId);
    if (!s) return;
    try {
      await window.api.updateSnippet(s.id, {
        title: s.title,
        language: s.language,
        tags: s.tags,
        code: s.code
      });
      showStatus('Salvo');
    } catch (err) {
      console.error('Falha ao salvar:', err);
      showStatus('⚠ Erro ao salvar');
    }
  }, 400);
}

function showStatus(msg) {
  els.status.textContent = msg;
  els.status.style.opacity = '1';
  setTimeout(() => (els.status.style.opacity = '0'), 1500);
}

async function deleteCurrent() {
  if (!confirm('Excluir este snippet?')) return;
  try {
    await window.api.deleteSnippet(currentId);
  } catch (err) {
    console.error('Falha ao excluir:', err);
    showStatus('⚠ Erro ao excluir');
    return;
  }
  snippets = snippets.filter((s) => s.id !== currentId);
  currentId = null;
  els.editor.classList.add('hidden');
  els.empty.classList.remove('hidden');
  await refreshMeta();
  renderLanguageFilter();
  renderTagPicker();
  renderList();
  showStatus('Excluído');
}

function copyCode() {
  window.api.copyToClipboard(els.code.value);
  showStatus('Copiado!');
}

function copyPreview() {
  const s = snippets.find((x) => x.id === currentId);
  if (!s) {
    copyCode();
    return;
  }
  if (s.language === 'markdown') {
    // Texto renderizado, sem marcações
    const text = els.rendered.innerText || els.rendered.textContent || '';
    window.api.copyToClipboard(text);
    showStatus('Copiado (formatado)');
  } else {
    // Preview de código com syntax highlighting = mesmo source
    window.api.copyToClipboard(els.code.value);
    showStatus('Copiado!');
  }
}

function openImageModal(imageSrc) {
  els.imageModal.classList.remove('hidden');
  modalFitWidth = 0;
  modalZoom = 100;
  els.imageModalZoom.value = 100;
  els.imageModalZoomValue.textContent = '100%';
  els.imageModalImg.style.maxWidth = 'none';
  els.imageModalImg.style.maxHeight = 'none';
  els.imageModalImg.style.width = '';
  els.imageModalImg.style.height = '';
  els.imageModalImg.src = imageSrc;
}

function closeImageModal() {
  els.imageModal.classList.add('hidden');
  els.imageModalImg.src = '';
  els.imageModalImg.style.width = '';
  els.imageModalImg.style.height = '';
}

function recomputeFitWidth() {
  const natW = els.imageModalImg.naturalWidth;
  const natH = els.imageModalImg.naturalHeight;
  if (!natW || !natH) return;
  const maxW = els.imageModalScroll.clientWidth;
  const maxH = els.imageModalScroll.clientHeight;
  const ratio = Math.min(maxW / natW, maxH / natH, 1);
  modalFitWidth = Math.max(1, natW * ratio);
}

function applyZoom() {
  if (!modalFitWidth) return;
  const factor = modalZoom / 100;
  els.imageModalImg.style.width = `${modalFitWidth * factor}px`;
  els.imageModalImg.style.height = 'auto';
  els.imageModalZoomValue.textContent = `${modalZoom}%`;
  els.imageModalZoom.value = String(modalZoom);
  // Wait for layout, then update scrollable cursor state
  requestAnimationFrame(updateScrollableCursor);
}

function updateScrollableCursor() {
  const scroll = els.imageModalScroll;
  if (!scroll) return;
  const scrollable =
    scroll.scrollWidth > scroll.clientWidth + 1 ||
    scroll.scrollHeight > scroll.clientHeight + 1;
  scroll.classList.toggle('scrollable', scrollable);
}

function setZoom(value) {
  modalZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value)));
  applyZoom();
}

function fitZoom() {
  setZoom(100);
  // Center the scroll position
  els.imageModalScroll.scrollTop = 0;
  els.imageModalScroll.scrollLeft = 0;
}

function imageFileUrl(fileName) {
  const normalized = String(window.imagePath || '').replace(/\\/g, '/');
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///';
  return prefix + encodeURI(`${normalized}/${fileName}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

function imageDisplayTitle(img) {
  return (img.title && img.title.trim()) || '';
}

function renderGallery() {
  const s = snippets.find((x) => x.id === currentId);
  if (!s || !s.images || s.images.length === 0) {
    els.gallery.classList.add('hidden');
    return;
  }

  els.gallery.classList.remove('hidden');
  els.gallery.innerHTML = s.images
    .map((img) => {
      const title = imageDisplayTitle(img);
      const isPlaceholder = !title;
      const displayText = title || '(clique para nomear)';
      return `
    <div class="image-item" data-image-id="${escapeHtml(img.id)}" title="${escapeHtml(img.fileName)}">
      <div class="image-thumb">
        <img src="${escapeHtml(imageFileUrl(img.fileName))}" alt="" />
        <button class="image-item-close" data-image-id="${escapeHtml(img.id)}">✕</button>
      </div>
      <div class="image-title${isPlaceholder ? ' placeholder' : ''}" data-image-id="${escapeHtml(img.id)}" title="Clique para editar">${escapeHtml(displayText)}</div>
    </div>
  `;
    })
    .join('');

  els.gallery.querySelectorAll('.image-thumb').forEach((thumb) => {
    thumb.addEventListener('click', (e) => {
      if (e.target.classList.contains('image-item-close')) return;
      const imageId = thumb.closest('.image-item').dataset.imageId;
      const img = s.images.find(i => i.id === imageId);
      if (img) {
        openImageModal(imageFileUrl(img.fileName));
      }
    });
  });

  els.gallery.querySelectorAll('.image-item-close').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteImage(btn.dataset.imageId);
    });
  });

  els.gallery.querySelectorAll('.image-title').forEach((label) => {
    label.addEventListener('click', (e) => {
      e.stopPropagation();
      startTitleEdit(label);
    });
  });
}

function startTitleEdit(labelEl) {
  if (labelEl.classList.contains('editing')) return;

  const imageId = labelEl.dataset.imageId;
  const snippet = snippets.find((x) => x.id === currentId);
  const img = snippet?.images?.find((i) => i.id === imageId);
  if (!img) return;

  const originalTitle = imageDisplayTitle(img);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'image-title-input';
  input.value = originalTitle;
  input.maxLength = 200;
  input.placeholder = 'Título da imagem';

  labelEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;

  const finish = async (commit) => {
    if (finished) return;
    finished = true;

    const newTitle = commit ? input.value.trim() : originalTitle;

    if (commit && newTitle !== originalTitle) {
      try {
        const updated = await window.api.renameImage(snippet.id, imageId, newTitle);
        const idx = snippets.findIndex((x) => x.id === snippet.id);
        if (idx !== -1) snippets[idx] = updated;
        renderGallery();
        showStatus('Título atualizado');
        return;
      } catch (err) {
        console.error('Falha ao renomear imagem:', err);
        showStatus('⚠ Erro ao renomear imagem');
      }
    }

    // Re-render (restores label even if no change / on cancel)
    renderGallery();
  };

  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
}

async function deleteImage(imageId) {
  const s = snippets.find((x) => x.id === currentId);
  if (!s) return;

  try {
    const updated = await window.api.deleteImage(s.id, imageId);
    const idx = snippets.findIndex((x) => x.id === s.id);
    if (idx !== -1) {
      snippets[idx] = updated;
    }
    renderGallery();
    showStatus('Imagem deletada');
  } catch (err) {
    console.error('Falha ao deletar imagem:', err);
    showStatus('⚠ Erro ao deletar imagem');
  }
}

async function uploadImage(filePath) {
  const s = snippets.find((x) => x.id === currentId);
  if (!s) return;

  try {
    const updated = await window.api.uploadImage(s.id, filePath);
    const idx = snippets.findIndex((x) => x.id === s.id);
    if (idx !== -1) {
      snippets[idx] = updated;
    }
    renderGallery();
    showStatus('Imagem adicionada');
  } catch (err) {
    console.error('Falha ao fazer upload:', err);
    showStatus('⚠ Erro ao fazer upload');
  }
}

els.newBtn.addEventListener('click', create);
els.sortBtn.addEventListener('click', toggleSort);
updateSortButton();
els.search.addEventListener('input', () => {
  setSearchingState(true);
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    searchQuery = els.search.value.trim();
    await reloadSnippets();
  }, 500);
});
els.languageFilter.addEventListener('change', (e) => {
  languageFilter = e.target.value;
  renderList();
});
els.tagPicker.addEventListener('change', (e) => {
  const tag = e.target.value;
  if (!tag) return;
  tagFilters.add(tag);
  renderTagPicker();
  renderList();
});
els.title.addEventListener('input', updateCurrent);
els.language.addEventListener('change', updateCurrent);
els.tags.addEventListener('input', updateCurrent);
els.code.addEventListener('input', updateCurrent);
els.copyBtn.addEventListener('click', copyCode);
els.copyEditorPanelBtn.addEventListener('click', copyCode);
els.copyPreviewPanelBtn.addEventListener('click', copyPreview);
els.uploadImageBtn.addEventListener('click', async () => {
  try {
    const filePaths = await window.api.selectImages();
    for (const filePath of filePaths) {
      await uploadImage(filePath);
    }
  } catch (err) {
    console.error('Erro ao selecionar imagens:', err);
  }
});
els.deleteBtn.addEventListener('click', deleteCurrent);
els.viewBtns.forEach((btn) => {
  btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
});

els.imageModalClose.addEventListener('click', closeImageModal);
els.imageModalOverlay.addEventListener('click', closeImageModal);
els.imageModalImg.addEventListener('load', () => {
  recomputeFitWidth();
  applyZoom();
});
els.imageModalZoom.addEventListener('input', (e) => {
  setZoom(Number(e.target.value));
});

let dragState = null;
els.imageModalScroll.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!els.imageModalScroll.classList.contains('scrollable')) return;
  dragState = {
    startX: e.clientX,
    startY: e.clientY,
    scrollLeft: els.imageModalScroll.scrollLeft,
    scrollTop: els.imageModalScroll.scrollTop
  };
  els.imageModalScroll.classList.add('dragging');
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!dragState) return;
  els.imageModalScroll.scrollLeft = dragState.scrollLeft - (e.clientX - dragState.startX);
  els.imageModalScroll.scrollTop = dragState.scrollTop - (e.clientY - dragState.startY);
});
window.addEventListener('mouseup', () => {
  if (!dragState) return;
  dragState = null;
  els.imageModalScroll.classList.remove('dragging');
});
els.imageModalZoomIn.addEventListener('click', () => setZoom(modalZoom + ZOOM_STEP));
els.imageModalZoomOut.addEventListener('click', () => setZoom(modalZoom - ZOOM_STEP));
els.imageModalZoomFit.addEventListener('click', fitZoom);

els.quitBtn.addEventListener('click', () => {
  window.api.quitApp();
});

els.code.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    const start = els.code.selectionStart;
    const end = els.code.selectionEnd;
    const value = els.code.value;
    const indent = '  ';
    els.code.value = value.slice(0, start) + indent + value.slice(end);
    els.code.selectionStart = els.code.selectionEnd = start + indent.length;
    updateCurrent();
  }
});

document.addEventListener('paste', handlePasteImage);

// Bloqueia drop de arquivos fora do editor (navegador abriria a imagem na janela)
window.addEventListener('dragover', (e) => {
  if (dragHasFiles(e.dataTransfer)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (dragHasFiles(e.dataTransfer)) e.preventDefault();
});

let dropDragCounter = 0;
els.editor.addEventListener('dragenter', (e) => {
  if (!currentId) return;
  if (!dragHasFiles(e.dataTransfer)) return;
  e.preventDefault();
  dropDragCounter++;
  els.editor.classList.add('drag-over');
});
els.editor.addEventListener('dragover', (e) => {
  if (!currentId) return;
  if (!dragHasFiles(e.dataTransfer)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
els.editor.addEventListener('dragleave', () => {
  if (dropDragCounter === 0) return;
  dropDragCounter--;
  if (dropDragCounter === 0) {
    els.editor.classList.remove('drag-over');
  }
});
els.editor.addEventListener('drop', async (e) => {
  if (!currentId) return;
  if (!dragHasFiles(e.dataTransfer)) return;
  e.preventDefault();
  dropDragCounter = 0;
  els.editor.classList.remove('drag-over');

  const files = Array.from(e.dataTransfer.files || []);
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) {
    showStatus('⚠ Solte apenas arquivos de imagem');
    return;
  }

  let added = 0;
  let failed = 0;
  for (const file of images) {
    try {
      const updated = await uploadDroppedFile(file);
      if (updated) {
        const idx = snippets.findIndex((x) => x.id === currentId);
        if (idx !== -1) snippets[idx] = updated;
        added++;
      }
    } catch (err) {
      console.error('Falha ao soltar imagem:', err);
      failed++;
    }
  }
  renderGallery();
  if (failed) {
    showStatus(`⚠ ${added} adicionada(s), ${failed} falhou`);
  } else {
    showStatus(`${added} imagem(ns) adicionada(s)`);
  }
});

document.addEventListener('keydown', (e) => {
  // Image modal shortcuts first (only when modal is open)
  if (!els.imageModal.classList.contains('hidden')) {
    if (e.key === 'Escape') {
      closeImageModal();
    } else if (e.key === '+' || (e.ctrlKey && e.key === '=')) {
      e.preventDefault();
      setZoom(modalZoom + ZOOM_STEP);
    } else if (e.key === '-' || (e.ctrlKey && e.key === '-')) {
      e.preventDefault();
      setZoom(modalZoom - ZOOM_STEP);
    } else if (e.key === '0' && e.ctrlKey) {
      e.preventDefault();
      fitZoom();
    }
    return;
  }

  // App-level shortcuts (only when logged in)
  if (els.appRoot.classList.contains('hidden')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  const key = e.key.toLowerCase();

  if (key === 'n') {
    e.preventDefault();
    create();
  } else if (key === 's') {
    e.preventDefault();
    forceSave();
  } else if (key === 'f') {
    e.preventDefault();
    els.search.focus();
    els.search.select();
  } else if (key === 'd') {
    if (!currentId) return;
    e.preventDefault();
    duplicateCurrent();
  }
});

init();
