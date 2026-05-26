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
  notes: {},          // tile id -> string
  history: [],        // [{ts, raw, top_id, top_sku, in_lib, photo}]
  settings: { base: 'https://token-plan-cn.xiaomimimo.com/v1', model: 'mimo-v2-omni', key: '' },
};

const LS = {
  PICKED: 'wt.picked.v1',
  SETTINGS: 'wt.settings.v1',
  HISTORY: 'wt.history.v1',
  NOTES: 'wt.notes.v1',
};

const HISTORY_CAP = 20;

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
  try {
    const h = JSON.parse(localStorage.getItem(LS.HISTORY) || '[]');
    STATE.history = Array.isArray(h) ? h.slice(0, HISTORY_CAP) : [];
  } catch { /* ignore */ }
  try {
    const n = JSON.parse(localStorage.getItem(LS.NOTES) || '{}');
    STATE.notes = (n && typeof n === 'object') ? n : {};
  } catch { /* ignore */ }
}

function savePicked() {
  localStorage.setItem(LS.PICKED, JSON.stringify([...STATE.picked]));
}
function saveSettings() {
  localStorage.setItem(LS.SETTINGS, JSON.stringify(STATE.settings));
}
function saveHistory() {
  localStorage.setItem(LS.HISTORY, JSON.stringify(STATE.history.slice(0, HISTORY_CAP)));
}
function saveNotes() {
  localStorage.setItem(LS.NOTES, JSON.stringify(STATE.notes));
}

function pushScanHistory({ raw, top, photo }) {
  // Photo dataUrls can be 200KB+ — strip them from history; we keep only the
  // raw OCR text and top candidate ref so the list is searchable later.
  const entry = {
    ts: Date.now(),
    raw: String(raw || '').slice(0, 200),
    top_id: top?.tile?.id || null,
    top_sku: top?.tile?.sku || null,
    top_brand: top?.tile?.brand || null,
    kind: top?.kind || 'none',
    similarity: top?.similarity || 0,
  };
  STATE.history.unshift(entry);
  STATE.history = STATE.history.slice(0, HISTORY_CAP);
  saveHistory();
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
  const top = candidates[0];
  const rest = candidates.slice(1);
  const detectedToken = (raw.toUpperCase().match(/[A-Z0-9]{3,}/) || [raw.slice(0, 40)])[0] || raw.slice(0, 40);

  // Persist to scan history
  pushScanHistory({ raw, top, photo: dataUrl });

  let bannerClass, bannerIcon, bannerText, bannerSub;
  if (top?.kind === 'exact') {
    bannerClass = 'banner-yes';
    bannerIcon = '✓';
    bannerText = '在表里';
    bannerSub = '京东直装这一款有。';
  } else if (top?.kind === 'near') {
    bannerClass = 'banner-maybe';
    bannerIcon = '?';
    bannerText = '可能是';
    bannerSub = '编码差几位，注意核对完整 SKU。';
  } else if (top) {
    bannerClass = 'banner-maybe';
    bannerIcon = '?';
    bannerText = '相近型号';
    bannerSub = '没找到精确匹配，下面是接近的。';
  } else {
    bannerClass = 'banner-no';
    bannerIcon = '✗';
    bannerText = '不在你的选单里';
    bannerSub = '这款 JD 直装没收录。可去淘宝/京东自查。';
  }

  const primaryHtml = top
    ? renderPrimaryCandidate(top)
    : `<div class="no-match-actions">
         <div class="detected">识别到的编码：<b>${escapeHtml(detectedToken)}</b></div>
         <div class="external">
           <a href="https://s.taobao.com/search?q=${encodeURIComponent(detectedToken)}" target="_blank" rel="noopener">淘宝搜</a>
           <a href="https://search.jd.com/Search?keyword=${encodeURIComponent(detectedToken)}" target="_blank" rel="noopener">京东搜</a>
         </div>
       </div>`;

  const restHtml = rest.length
    ? `<details class="more-candidates">
         <summary>其他 ${rest.length} 个相近型号</summary>
         ${rest.map(c => renderSecondaryCandidate(c)).join('')}
       </details>`
    : '';

  openRecog(`
    <div class="recog-banner ${bannerClass}">
      <div class="banner-icon">${bannerIcon}</div>
      <div class="banner-text">
        <div class="banner-title">${bannerText}</div>
        <div class="banner-sub">${bannerSub}</div>
      </div>
    </div>
    ${primaryHtml}
    ${restHtml}
    <details class="raw-details">
      <summary>识别原文 / 拍的照片</summary>
      <img src="${dataUrl}" class="photo" alt="" />
      <div class="raw">${escapeHtml(raw)}</div>
    </details>
  `);
}

function renderPrimaryCandidate({ tile, kind, similarity }) {
  const thumb = tile.single?.thumb || tile.room?.thumb;
  const img = thumb
    ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(tile.sku)}" />`
    : `<div class="ph-big">无图</div>`;
  const picked = STATE.picked.has(tile.id);
  const pct = Math.round(similarity * 100);
  return `
    <div class="primary-candidate" data-id="${tile.id}">
      ${img}
      <div class="primary-meta">
        <div class="primary-sku">${escapeHtml(tile.sku)}</div>
        <div class="primary-sub">${escapeHtml(tile.brand)} · ${escapeHtml(tile.spec || '—')} · ${escapeHtml(tile.category_short || '')}</div>
        <div class="primary-conf">匹配度 ${pct}%${kind === 'exact' ? ' · 精确' : ''}</div>
        <div class="primary-actions">
          <button class="primary-action" data-open="${tile.id}">查看详情</button>
          <button class="primary-action ${picked ? 'picked' : 'primary'}" data-pick="${tile.id}">${picked ? '✓ 已选' : '加到清单'}</button>
        </div>
      </div>
    </div>
  `;
}

function renderSecondaryCandidate({ tile, kind, similarity }) {
  const thumb = tile.single?.thumb || tile.room?.thumb;
  const imgHtml = thumb ? `<img src="${escapeHtml(thumb)}" alt="" />` : `<div class="ph">无图</div>`;
  const pct = Math.round(similarity * 100);
  const badge = kind === 'exact' ? '精确' : kind === 'near' ? `接近 ${pct}%` : `相近 ${pct}%`;
  const badgeClass = kind === 'exact' ? 'exact' : kind === 'near' ? 'near' : 'loose';
  return `<button class="candidate" data-id="${tile.id}">
    ${imgHtml}
    <div class="candidate-meta">
      <div class="sku">${escapeHtml(tile.sku)}<span class="match-badge ${badgeClass}">${badge}</span></div>
      <div class="sub">${escapeHtml(tile.brand)} · ${escapeHtml(tile.spec || '—')} · ${escapeHtml(tile.category_short || '')}</div>
    </div>
  </button>`;
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

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function matchSkuCandidates(rawText) {
  // Returns sorted candidates [{tile, distance, similarity, kind}] where kind is
  // 'exact' (distance 0), 'near' (similarity ≥ 0.78), or 'loose' (≥ 0.55). Lower
  // is dropped — caller treats empty as "not in your list".
  if (!rawText || /^NONE$/i.test(rawText.trim())) return [];
  const tokens = (rawText.toUpperCase().match(/[A-Z0-9]{4,}/g) || []);
  if (tokens.length === 0) return [];

  const scored = [];
  for (const t of STATE.all) {
    const canon = tokenizeSku(t.sku);
    if (canon.length < 3) continue;
    let bestDistance = Infinity;
    let bestSim = 0;
    for (const tok of tokens) {
      const d = levenshtein(canon, tok);
      const longer = Math.max(canon.length, tok.length);
      const sim = longer === 0 ? 0 : 1 - d / longer;
      if (sim > bestSim) { bestSim = sim; bestDistance = d; }
      // Substring bonus: a contained token shouldn't lose to slightly closer noise.
      if (canon.includes(tok) || tok.includes(canon)) {
        const shorter = Math.min(canon.length, tok.length);
        const containSim = shorter / longer;
        if (containSim > bestSim) {
          bestSim = containSim;
          bestDistance = longer - shorter;
        }
      }
    }
    if (bestSim < 0.55) continue;
    let kind;
    if (bestDistance === 0) kind = 'exact';
    else if (bestSim >= 0.78) kind = 'near';
    else kind = 'loose';
    scored.push({ tile: t, distance: bestDistance, similarity: bestSim, kind });
  }
  scored.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return a.tile.sku.localeCompare(b.tile.sku);
  });
  return scored.slice(0, 8);
}

// ---------- Pick toggle ----------
function togglePick(id) {
  if (STATE.picked.has(id)) STATE.picked.delete(id);
  else STATE.picked.add(id);
  savePicked();
  updatePicksBadge();
  applyFilters();
}

function updatePicksBadge() {
  const badge = $('#picks-count-badge');
  if (!badge) return;
  const n = STATE.picked.size;
  badge.textContent = n;
  badge.hidden = n === 0;
}

// ---------- Picks dialog ----------
const picksDlg = $('#picks-dialog');
const picksBody = $('#picks-body');

function openPicks() {
  const picked = STATE.all.filter(t => STATE.picked.has(t.id));
  if (picked.length === 0) {
    picksBody.innerHTML = `
      <h2>我的清单</h2>
      <div class="empty-result">还没勾选任何型号。在型号详情页点"加到清单"。</div>
    `;
    if (!picksDlg.open) picksDlg.showModal();
    return;
  }
  // Group by brand
  const groups = new Map();
  for (const t of picked) {
    if (!groups.has(t.brand)) groups.set(t.brand, []);
    groups.get(t.brand).push(t);
  }
  const groupsHtml = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'zh'))
    .map(([brand, tiles]) => {
      const rows = tiles.map(t => {
        const note = STATE.notes[t.id] || '';
        const thumb = t.single?.thumb || t.room?.thumb;
        const imgHtml = thumb
          ? `<img src="${escapeHtml(thumb)}" alt="" />`
          : `<div class="ph">无图</div>`;
        return `
          <div class="pick-row" data-id="${t.id}">
            ${imgHtml}
            <div class="pick-meta">
              <div class="pick-sku">${escapeHtml(t.sku)}</div>
              <div class="pick-sub">${escapeHtml(t.spec || '—')} · ${escapeHtml(t.category_short || '—')}</div>
              <input class="pick-note" type="text" data-note-id="${t.id}" value="${escapeHtml(note)}" placeholder="给这块砖记一笔（如：客厅地面）" />
            </div>
            <div class="pick-actions">
              <button class="pick-open" data-open="${t.id}">查看</button>
              <button class="pick-remove" data-pick="${t.id}">移出</button>
            </div>
          </div>
        `;
      }).join('');
      return `
        <div class="pick-group">
          <div class="pick-group-h">${escapeHtml(brand)} <span class="pick-count">${tiles.length}</span></div>
          ${rows}
        </div>
      `;
    }).join('');
  picksBody.innerHTML = `
    <h2>我的清单 <span class="muted small">${picked.length} 个</span></h2>
    <div class="picks-actions">
      <button id="btn-copy-picks" class="primary">复制清单</button>
      <button id="btn-share-picks" class="ghost">分享…</button>
    </div>
    ${groupsHtml}
  `;
  if (!picksDlg.open) picksDlg.showModal();
}

function picksAsText() {
  const picked = STATE.all.filter(t => STATE.picked.has(t.id));
  if (picked.length === 0) return '';
  const groups = new Map();
  for (const t of picked) {
    if (!groups.has(t.brand)) groups.set(t.brand, []);
    groups.get(t.brand).push(t);
  }
  const lines = ['【瓷砖选单】共 ' + picked.length + ' 款', ''];
  for (const [brand, tiles] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
    lines.push(`▎${brand}`);
    for (const t of tiles) {
      const note = STATE.notes[t.id];
      lines.push(`  ${t.sku}  ${t.spec || ''}  ${t.category_short || ''}${note ? '  // ' + note : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

// ---------- History dialog ----------
const historyDlg = $('#history-dialog');
const historyBody = $('#history-body');

function openHistory() {
  if (STATE.history.length === 0) {
    historyBody.innerHTML = `
      <h2>扫描历史</h2>
      <div class="empty-result">还没扫过任何瓷砖。点右下角相机按钮开始。</div>
    `;
    if (!historyDlg.open) historyDlg.showModal();
    return;
  }
  const rows = STATE.history.map((h, i) => {
    const t = h.top_id ? STATE.all.find(x => x.id === h.top_id) : null;
    const thumb = t?.single?.thumb || t?.room?.thumb;
    const imgHtml = thumb
      ? `<img src="${escapeHtml(thumb)}" alt="" />`
      : `<div class="ph">${h.kind === 'none' ? '✗' : '?'}</div>`;
    const ago = relativeTime(h.ts);
    const badge = h.kind === 'exact' ? '<span class="match-badge exact">在表里</span>'
      : h.kind === 'near' ? `<span class="match-badge near">可能是 ${Math.round(h.similarity * 100)}%</span>`
      : h.kind === 'loose' ? `<span class="match-badge loose">相近 ${Math.round(h.similarity * 100)}%</span>`
      : '<span class="match-badge no">不在表里</span>';
    const sku = h.top_sku ? escapeHtml(h.top_sku) : `<span class="muted">${escapeHtml(h.raw || '(空)')}</span>`;
    return `
      <button class="history-row" data-id="${h.top_id || ''}" data-history-idx="${i}">
        ${imgHtml}
        <div class="hist-meta">
          <div class="hist-sku">${sku} ${badge}</div>
          <div class="hist-sub">${h.top_brand ? escapeHtml(h.top_brand) + ' · ' : ''}${ago}</div>
        </div>
      </button>
    `;
  }).join('');
  historyBody.innerHTML = `
    <h2>扫描历史 <span class="muted small">最近 ${STATE.history.length} 条</span></h2>
    <div class="picks-actions">
      <button id="btn-clear-history" class="ghost">清空历史</button>
    </div>
    ${rows}
  `;
  if (!historyDlg.open) historyDlg.showModal();
}

function relativeTime(ts) {
  const delta = Math.max(0, Date.now() - ts);
  const m = Math.floor(delta / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' 天前';
  return new Date(ts).toLocaleDateString('zh-CN');
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

  // Recog candidate click (secondary candidates use .candidate; primary uses [data-open])
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

  // Settings / picks / history
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-picks').addEventListener('click', openPicks);
  $('#btn-history').addEventListener('click', openHistory);

  // Picks dialog event delegation
  picksBody.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { picksDlg.close(); openDetail(Number(open.dataset.open)); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      togglePick(Number(pick.dataset.pick));
      openPicks(); // re-render
      return;
    }
    if (e.target.id === 'btn-copy-picks') {
      const text = picksAsText();
      if (text) copyText(text); else toast('清单为空');
      return;
    }
    if (e.target.id === 'btn-share-picks') {
      const text = picksAsText();
      if (!text) { toast('清单为空'); return; }
      if (navigator.share) {
        navigator.share({ title: '瓷砖选单', text }).catch(() => {});
      } else {
        copyText(text);
      }
      return;
    }
  });
  picksBody.addEventListener('input', (e) => {
    const noteInput = e.target.closest('[data-note-id]');
    if (!noteInput) return;
    const id = Number(noteInput.dataset.noteId);
    const val = noteInput.value.trim();
    if (val) STATE.notes[id] = val;
    else delete STATE.notes[id];
    saveNotes();
  });

  // History dialog event delegation
  historyBody.addEventListener('click', (e) => {
    if (e.target.id === 'btn-clear-history') {
      if (!confirm('清空扫描历史？')) return;
      STATE.history = [];
      saveHistory();
      openHistory();
      return;
    }
    const row = e.target.closest('.history-row');
    if (!row) return;
    const id = Number(row.dataset.id);
    if (id) { historyDlg.close(); openDetail(id); }
  });

  // Recog dialog primary actions
  recogBody.addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-open]');
    if (openBtn) {
      recogDlg.close();
      openDetail(Number(openBtn.dataset.open));
      return;
    }
    const pickBtn = e.target.closest('[data-pick]');
    if (pickBtn) {
      togglePick(Number(pickBtn.dataset.pick));
      // Re-render the recog dialog with updated pick state (simple: reload from cached candidates)
      // Easiest: just toast feedback; user can close manually.
      const btn = pickBtn;
      if (STATE.picked.has(Number(pickBtn.dataset.pick))) {
        btn.textContent = '✓ 已选';
        btn.classList.remove('primary');
        btn.classList.add('picked');
      } else {
        btn.textContent = '加到清单';
        btn.classList.add('primary');
        btn.classList.remove('picked');
      }
      return;
    }
  });

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
  updatePicksBadge();
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
