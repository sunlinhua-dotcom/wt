// 瓷砖速查 — single-file frontend.
// State persisted in localStorage: settings (Mimo base/model/key), picked SKU ids.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const STATE = {
  all: [],            // all tiles
  filtered: [],       // current filtered list
  pageSize: 60,
  rendered: 0,
  brand: '',          // '' = all
  spec: '',
  cat: '',
  query: '',
  onlyImages: false,
  onlyPicked: false,
  picked: new Set(),  // tile ids
  settings: { base: 'https://token-plan-cn.xiaomimimo.com/v1', model: 'mimo-v2-omni', key: '' },
};

const LS = {
  PICKED: 'wt.picked.v1',
  SETTINGS: 'wt.settings.v1',
};

// ---------- Persistence ----------
function loadPersisted() {
  try {
    const p = JSON.parse(localStorage.getItem(LS.PICKED) || '[]');
    STATE.picked = new Set(p);
  } catch { /* ignore */ }
  try {
    const s = JSON.parse(localStorage.getItem(LS.SETTINGS) || '{}');
    Object.assign(STATE.settings, s);
  } catch { /* ignore */ }
}

function savePicked() {
  localStorage.setItem(LS.PICKED, JSON.stringify([...STATE.picked]));
}
function saveSettings() {
  localStorage.setItem(LS.SETTINGS, JSON.stringify(STATE.settings));
}

// ---------- Data load ----------
async function loadData() {
  const res = await fetch('data/tiles.json');
  if (!res.ok) throw new Error('数据加载失败');
  const data = await res.json();
  STATE.all = Array.isArray(data?.tiles) ? data.tiles : [];
  if (STATE.all.length === 0) throw new Error('tiles.json 为空或格式不对');
  return data;
}

// ---------- Filtering ----------
function normalize(s) {
  return (s || '').toString().toLowerCase().replace(/\s+/g, '');
}

function applyFilters() {
  const q = normalize(STATE.query);
  const list = STATE.all.filter(t => {
    if (STATE.brand && t.brand !== STATE.brand) return false;
    if (STATE.spec && t.spec !== STATE.spec) return false;
    if (STATE.cat && t.category_short !== STATE.cat) return false;
    if (STATE.onlyImages && !t.has_images) return false;
    if (STATE.onlyPicked && !STATE.picked.has(t.id)) return false;
    if (q) {
      const hay = normalize(t.sku) + '|' + normalize(t.spec) + '|' + normalize(t.category_short) + '|' + normalize(t.brand);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // Sort: picked first, then has_images, then brand, then sku
  list.sort((a, b) => {
    const pa = STATE.picked.has(a.id) ? 0 : 1;
    const pb = STATE.picked.has(b.id) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a.has_images !== b.has_images) return a.has_images ? -1 : 1;
    if (a.brand !== b.brand) return a.brand.localeCompare(b.brand, 'zh');
    return a.sku.localeCompare(b.sku);
  });
  STATE.filtered = list;
  STATE.rendered = 0;
  renderList(true);
  updateStatus();
}

function updateStatus() {
  const total = STATE.all.length;
  const shown = STATE.filtered.length;
  const picked = STATE.picked.size;
  let txt = `${shown}/${total} 个型号`;
  if (picked) txt += ` · 已选 ${picked}`;
  $('#status').textContent = txt;
}

// ---------- Rendering ----------
const list = $('#list');

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function cardHtml(t) {
  const sku = escapeHtml(t.sku);
  const spec = escapeHtml(t.spec);
  const brand = escapeHtml(t.brand);
  const cat = escapeHtml(t.category_short);
  const picked = STATE.picked.has(t.id);
  const imgInner = t.single?.thumb
    ? `<img src="${escapeHtml(t.single.thumb)}" alt="${escapeHtml(t.sku)}" loading="lazy" decoding="async" />`
    : t.room?.thumb
      ? `<img src="${escapeHtml(t.room.thumb)}" alt="${escapeHtml(t.sku)}" loading="lazy" decoding="async" />`
      : '';
  const placeholder = imgInner ? '' : 'placeholder';
  const pickMark = picked ? '<span class="pick-mark" aria-label="已选">✓</span>' : '';
  return `
    <button class="card" data-id="${t.id}">
      <div class="img-wrap ${placeholder}">
        <span class="brand-tag">${brand}</span>
        ${pickMark}
        ${imgInner}
      </div>
      <div class="meta">
        <div class="sku">${sku}</div>
        <div class="sub">
          <span>${spec || '—'}</span>
          <span>${cat || '—'}</span>
        </div>
      </div>
    </button>
  `;
}

function renderList(reset) {
  if (reset) {
    list.innerHTML = '';
    STATE.rendered = 0;
  }
  if (STATE.filtered.length === 0) {
    list.innerHTML = '<div class="empty">没有匹配的型号</div>';
    return;
  }
  const end = Math.min(STATE.rendered + STATE.pageSize, STATE.filtered.length);
  const html = STATE.filtered.slice(STATE.rendered, end).map(cardHtml).join('');
  list.insertAdjacentHTML('beforeend', html);
  STATE.rendered = end;
}

// ---------- Detail dialog ----------
const detailDlg = $('#detail-dialog');
const detailBody = $('#detail-body');

function openDetail(id) {
  const t = STATE.all.find(x => x.id === id);
  if (!t) return;
  const picked = STATE.picked.has(t.id);
  const skuEnc = encodeURIComponent(t.sku);
  const imgs = [];
  if (t.single?.full) imgs.push({ src: t.single.full, label: '单片效果图' });
  if (t.room?.full) imgs.push({ src: t.room.full, label: '实铺效果图' });
  const imgsHtml = imgs.length
    ? '<div class="imgs">' + imgs.map(i =>
        `<figure><img src="${escapeHtml(i.src)}" alt="${escapeHtml(t.sku)} ${i.label}" /><figcaption>${i.label}</figcaption></figure>`
      ).join('') + '</div>'
    : '<div class="imgs"><figure><figcaption style="padding:20px;text-align:center;">此型号无内嵌图，可点下方按钮去淘宝/京东搜</figcaption></figure></div>';

  detailBody.innerHTML = `
    ${imgsHtml}
    <h2>${escapeHtml(t.sku)}</h2>
    <div class="row"><b>${escapeHtml(t.brand)}</b> · ${escapeHtml(t.spec || '—')} · ${escapeHtml(t.category_short || '')}</div>
    <div class="row" style="color:var(--text-muted);font-size:11px;">${escapeHtml(t.category)}</div>
    <div class="actions">
      <button class="primary ${picked ? 'picked' : ''}" data-pick="${t.id}">${picked ? '✓ 已加到我的清单' : '加到我的清单'}</button>
      <button data-copy="${escapeHtml(t.sku)}">复制型号</button>
      <a href="https://s.taobao.com/search?q=${skuEnc}" target="_blank" rel="noopener">淘宝搜</a>
      <a href="https://search.jd.com/Search?keyword=${skuEnc}" target="_blank" rel="noopener">京东搜</a>
    </div>
  `;
  if (!detailDlg.open) detailDlg.showModal();
}

// ---------- Settings dialog ----------
const settingsDlg = $('#settings-dialog');
function openSettings() {
  $('#setting-base').value = STATE.settings.base;
  $('#setting-model').value = STATE.settings.model;
  $('#setting-key').value = STATE.settings.key;
  $('#count-total').textContent = STATE.all.length;
  const nobel = STATE.all.filter(t => t.brand === '诺贝尔').length;
  $('#count-pickable').textContent = nobel;
  if (!settingsDlg.open) settingsDlg.showModal();
}

$('#btn-save-settings').addEventListener('click', () => {
  const base = $('#setting-base').value.trim() || STATE.settings.base;
  try {
    const u = new URL(base);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    toast('Base URL 格式不对');
    return;
  }
  STATE.settings.base = base.replace(/\/+$/, '');
  STATE.settings.model = $('#setting-model').value.trim() || STATE.settings.model;
  STATE.settings.key = $('#setting-key').value.trim();
  saveSettings();
  settingsDlg.close();
  toast('已保存设置');
});

$('#btn-clear-picked').addEventListener('click', () => {
  if (!confirm('清空所有已选记录？')) return;
  STATE.picked.clear();
  savePicked();
  applyFilters();
  toast('已清空已选');
});

// ---------- Recognition ----------
const recogDlg = $('#recog-dialog');
const recogBody = $('#recog-body');

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(file);
  });
}

async function downscaleImage(file, maxDim = 1280, quality = 0.82) {
  // Phone photos are 4000+px and tens of MB. createImageBitmap decodes off-thread
  // without first holding the full file as a 24MB+ data-URL string, which OOMs
  // older iPhones.
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    // Fallback for browsers without createImageBitmap on File: use data URL.
    const dataUrl = await fileToDataUrl(file);
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    bmp = img;
  }
  const w = bmp.width, h = bmp.height;
  let nw = w, nh = h;
  if (Math.max(w, h) > maxDim) {
    if (w >= h) { nw = maxDim; nh = Math.round(h * maxDim / w); }
    else { nh = maxDim; nw = Math.round(w * maxDim / h); }
  }
  const canvas = document.createElement('canvas');
  canvas.width = nw; canvas.height = nh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, nw, nh);
  if (bmp.close) bmp.close();
  return canvas.toDataURL('image/jpeg', quality);
}

function openRecog(initialHtml) {
  recogBody.innerHTML = initialHtml;
  if (!recogDlg.open) recogDlg.showModal();
}

let recogInFlight = null;
async function recognizePhoto(file) {
  if (!STATE.settings.key) {
    openSettings();
    toast('请先在设置里填 Mimo API key');
    return;
  }
  // Cancel any prior in-flight call so a late response can't paint over a fresh one.
  if (recogInFlight) recogInFlight.abort();
  const ctrl = new AbortController();
  recogInFlight = ctrl;
  openRecog('<div class="spinner">压缩照片中…</div>');
  let dataUrl;
  try {
    dataUrl = await downscaleImage(file, 1280, 0.82);
  } catch (e) {
    openRecog(`<div class="empty-result">照片处理失败：${escapeHtml(String(e.message || e))}</div>`);
    return;
  }

  openRecog(`
    <img src="${dataUrl}" class="photo" alt="待识别照片" />
    <div class="spinner">识别中… (可能需要 3-10 秒)</div>
  `);

  let raw;
  try {
    raw = await callMimoOCR(dataUrl, ctrl.signal);
  } catch (e) {
    if (e?.name === 'AbortError') return; // superseded by a newer photo
    openRecog(`
      <img src="${dataUrl}" class="photo" alt="" />
      <h2>识别失败</h2>
      <div class="raw">${escapeHtml(String(e.message || e))}</div>
      <p class="muted small">检查设置里的 base URL / key / 模型名是否正确。可以手动在搜索框输入 SKU。</p>
    `);
    return;
  }
  if (ctrl.signal.aborted) return;

  const candidates = matchSkuCandidates(raw);
  let candHtml = '';
  if (candidates.length === 0) {
    // Clamp raw text → first alphanumeric blob, fall back to first 40 chars,
    // so external search URLs are never broken by line breaks / huge OCR replies.
    const firstToken = (raw.toUpperCase().match(/[A-Z0-9]{3,}/) || [raw.slice(0, 40)])[0];
    const q = encodeURIComponent(firstToken);
    candHtml = `<div class="empty-result">表中未找到匹配。识别码: <b>${escapeHtml(firstToken)}</b></div>
      <div class="external">
        <a href="https://s.taobao.com/search?q=${q}" target="_blank" rel="noopener">淘宝搜</a>
        <a href="https://search.jd.com/Search?keyword=${q}" target="_blank" rel="noopener">京东搜</a>
      </div>`;
  } else {
    candHtml = candidates.map(({ tile, kind }) => {
      const thumb = tile.single?.thumb || tile.room?.thumb;
      const imgHtml = thumb
        ? `<img src="${escapeHtml(thumb)}" alt="" />`
        : `<div class="ph">无图</div>`;
      const badgeClass = kind === 'exact' ? 'exact' : 'fuzzy';
      const badgeText = kind === 'exact' ? '精确' : '近似';
      return `<button class="candidate" data-id="${tile.id}">
        ${imgHtml}
        <div class="candidate-meta">
          <div class="sku">${escapeHtml(tile.sku)}<span class="match-badge ${badgeClass}">${badgeText}</span></div>
          <div class="sub">${escapeHtml(tile.brand)} · ${escapeHtml(tile.spec || '—')} · ${escapeHtml(tile.category_short || '')}</div>
        </div>
      </button>`;
    }).join('');
  }

  openRecog(`
    <img src="${dataUrl}" class="photo" alt="" />
    <h2>识别结果</h2>
    <div class="raw">${escapeHtml(raw)}</div>
    ${candHtml}
  `);
}

async function callMimoOCR(dataUrl, signal) {
  const base = (STATE.settings.base || '').replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const prompt = '这是一张瓷砖样品（包装、标签、铭牌或瓷砖背面）的照片。请只输出图中可见的瓷砖型号 SKU 编码，不要解释。如果有多个候选编码请用空格分隔。如果没有任何可识别的型号编码，回复"NONE"。';
  const body = {
    model: STATE.settings.model || 'mimo-v2-omni',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
    // mimo-v2-omni is a reasoning model that spends ~200 tokens on internal
    // thinking before producing output, so leave plenty of headroom.
    max_tokens: 600,
    temperature: 0,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${STATE.settings.key}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content || '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map(p => p?.text || '').join(' ').trim();
  return JSON.stringify(content);
}

// ---------- SKU matching ----------
function tokenizeSku(s) {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function matchSkuCandidates(rawText) {
  if (!rawText || /^NONE$/i.test(rawText.trim())) return [];
  // Pull alphanumeric blobs of length >= 4 from the raw text.
  const tokens = (rawText.toUpperCase().match(/[A-Z0-9]{4,}/g) || []);
  if (tokens.length === 0) return [];

  const exact = new Map(); // id -> tile
  const fuzzy = new Map();

  // Pre-index all tiles by canonical SKU
  for (const t of STATE.all) {
    const canon = tokenizeSku(t.sku);
    for (const tok of tokens) {
      if (canon === tok) {
        exact.set(t.id, t);
      } else if (canon.includes(tok) || tok.includes(canon)) {
        if (canon.length >= 4 && tok.length >= 4) {
          // Avoid garbage matches on very short shared substrings
          const common = Math.min(canon.length, tok.length);
          const longer = Math.max(canon.length, tok.length);
          if (common / longer >= 0.6) {
            fuzzy.set(t.id, t);
          }
        }
      } else {
        // Levenshtein-ish: substring overlap >= 5 chars
        if (sharedSubstring(canon, tok) >= 5) {
          fuzzy.set(t.id, t);
        }
      }
    }
  }
  const out = [];
  for (const t of exact.values()) out.push({ tile: t, kind: 'exact' });
  for (const t of fuzzy.values()) {
    if (!exact.has(t.id)) out.push({ tile: t, kind: 'fuzzy' });
  }
  // Limit to top 12 results
  return out.slice(0, 12);
}

function sharedSubstring(a, b) {
  // Length of longest common substring (DP, capped for performance).
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  if (m * n > 4000) {
    // Fallback: rolling window check for length 5+
    for (let len = Math.min(m, n); len >= 5; len--) {
      for (let i = 0; i + len <= m; i++) {
        if (b.includes(a.substr(i, len))) return len;
      }
      break;
    }
    return 0;
  }
  let best = 0;
  const dp = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const cur = dp[j];
      if (a[i-1] === b[j-1]) {
        dp[j] = prev + 1;
        if (dp[j] > best) best = dp[j];
      } else {
        dp[j] = 0;
      }
      prev = cur;
    }
  }
  return best;
}

// ---------- Pick toggle ----------
function togglePick(id) {
  if (STATE.picked.has(id)) STATE.picked.delete(id);
  else STATE.picked.add(id);
  savePicked();
  applyFilters();
}

// ---------- UI wiring ----------
function buildBrandTabs(brandCounts) {
  const tabs = $('#brand-tabs');
  const total = STATE.all.length;
  const brands = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]);
  const entries = [['', '全部', total], ...brands.map(([b, n]) => [b, b, n])];
  tabs.innerHTML = entries.map(([key, label, count]) =>
    `<button class="chip ${key === STATE.brand ? 'active' : ''}" data-brand="${escapeHtml(key)}">
      ${escapeHtml(label)}<span class="count">${count}</span>
    </button>`
  ).join('');
}

function buildSelects() {
  const specs = [...new Set(STATE.all.map(t => t.spec).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const cats = [...new Set(STATE.all.map(t => t.category_short).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh'));
  $('#filter-spec').innerHTML = '<option value="">全部规格</option>' +
    specs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  $('#filter-cat').innerHTML = '<option value="">全部分类</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

function toast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

function wire() {
  // Brand tabs (event delegation)
  $('#brand-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    STATE.brand = btn.dataset.brand;
    $$('#brand-tabs .chip').forEach(c => c.classList.toggle('active', c.dataset.brand === STATE.brand));
    applyFilters();
    window.scrollTo({ top: 0 });
  });

  // Search
  let searchDebounce;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      STATE.query = e.target.value;
      applyFilters();
    }, 120);
  });
  $('#btn-clear-search').addEventListener('click', () => {
    $('#search').value = '';
    STATE.query = '';
    applyFilters();
  });

  // Filters
  $('#filter-spec').addEventListener('change', (e) => { STATE.spec = e.target.value; applyFilters(); });
  $('#filter-cat').addEventListener('change', (e) => { STATE.cat = e.target.value; applyFilters(); });
  $('#filter-only-images').addEventListener('change', (e) => { STATE.onlyImages = e.target.checked; applyFilters(); });
  $('#filter-only-picked').addEventListener('change', (e) => { STATE.onlyPicked = e.target.checked; applyFilters(); });

  // Card clicks
  list.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = Number(card.dataset.id);
    openDetail(id);
  });

  // Detail dialog actions
  detailBody.addEventListener('click', (e) => {
    const pickBtn = e.target.closest('[data-pick]');
    if (pickBtn) {
      togglePick(Number(pickBtn.dataset.pick));
      detailDlg.close();
      return;
    }
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      const text = copyBtn.dataset.copy;
      copyText(text);
      return;
    }
  });

  // Recog candidate click
  recogBody.addEventListener('click', (e) => {
    const cand = e.target.closest('.candidate');
    if (!cand) return;
    recogDlg.close();
    openDetail(Number(cand.dataset.id));
  });

  // Dialog close buttons
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close]');
    if (!closeBtn) return;
    const dlg = closeBtn.closest('dialog');
    if (dlg) dlg.close();
  });

  // Camera
  $('#btn-camera').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow reselect of same file
    if (!file) return;
    await recognizePhoto(file);
  });

  // Settings
  $('#btn-settings').addEventListener('click', openSettings);

  // Infinite scroll via IntersectionObserver
  const sentinel = $('#sentinel');
  const io = new IntersectionObserver((entries) => {
    for (const ent of entries) {
      if (ent.isIntersecting && STATE.rendered < STATE.filtered.length) {
        renderList(false);
      }
    }
  }, { rootMargin: '600px' });
  io.observe(sentinel);

  // Topbar height → CSS var so body padding tracks expanding filter section.
  const topbar = document.querySelector('.topbar');
  if (topbar) {
    const updateTopbar = () => {
      document.documentElement.style.setProperty('--topbar-h', topbar.offsetHeight + 'px');
    };
    if ('ResizeObserver' in window) {
      new ResizeObserver(updateTopbar).observe(topbar);
    }
    updateTopbar();
    window.addEventListener('resize', updateTopbar);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制 ' + text);
  } catch {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    ta.remove();
    toast('已复制 ' + text);
  }
}

// ---------- Boot ----------
function consumeUrlHashConfig() {
  // Support a one-shot bootstrap link of the form `.../#key=tp-xxx`.
  // We DELIBERATELY only accept `key` from the hash — never base/model — so a
  // crafted link can't redirect the next OCR call (with its photo + the user's
  // existing key) to an attacker-controlled endpoint.
  if (!window.location.hash || window.location.hash.length < 2) return;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const k = params.get('key');
  if (!k || !/^tp-[A-Za-z0-9_-]{8,}$/.test(k)) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return;
  }
  STATE.settings.key = k;
  saveSettings();
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

async function boot() {
  loadPersisted();
  consumeUrlHashConfig();
  try {
    const data = await loadData();
    buildBrandTabs(data.brand_counts);
    buildSelects();
    wire();
    applyFilters();
    if (!STATE.settings.key) {
      // First-launch: open settings immediately so the API key is visible business.
      $('#status').textContent = `${STATE.all.length} 个型号 · 点 ⚙ 设置 API key 后可用拍照识别`;
      // Defer to next tick so the list paints behind the modal.
      setTimeout(openSettings, 100);
    }
  } catch (e) {
    $('#status').textContent = '加载失败：' + e.message;
  }
}

boot();
