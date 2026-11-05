/* =====================================================================
   NamouSI – script.js của WEBSITE PUBLIC (dự án riêng).
   Dùng cùng một Supabase với website Admin (dự án / domain khác). Chỉ dùng khóa anon.
   Ảnh là URL lưu trong database (ảnh nằm trong repo GitHub).
   ===================================================================== */
(() => {
  'use strict';

  /* ===== 1. CẤU HÌNH – điền 2 giá trị dưới đây =====
     Lấy tại Supabase → Project Settings → API:
       - Project URL
       - anon / publishable key (khóa CÔNG KHAI)
     TUYỆT ĐỐI KHÔNG dán service_role / secret key vào đây. */
  const SUPABASE_URL = 'https://aulcrgxmrmcgjjiztyuj.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_wzjzypPB3TCdGOkydRzisw_s4D_dlw6';

  /* ===== 2. TIỆN ÍCH ===== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '');
  const fmtDate = v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleString('vi-VN') : '—'; };
  const stateHTML = (type, msg) =>
    `<div class="state state-${type}" role="${type === 'error' ? 'alert' : 'status'}">${type === 'loading' ? '<span class="spinner" aria-hidden="true"></span>' : ''}<p>${esc(msg)}</p></div>`;

  function friendlyError(e) {
    const m = String((e && e.message) || e || '');
    const c = e && e.code;
    if (/invalid login credentials/i.test(m)) return 'Email hoặc mật khẩu không đúng.';
    if (/email not confirmed/i.test(m)) return 'Email chưa được xác nhận trong Supabase.';
    if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Không kết nối được tới Supabase. Kiểm tra mạng và SUPABASE_URL.';
    if (/invalid api key|invalid jwt/i.test(m)) return 'API key không hợp lệ. Kiểm tra SUPABASE_ANON_KEY.';
    if (c === '42501' || /row-level security|permission denied/i.test(m)) return 'Bạn không có quyền thực hiện thao tác này.';
    if (c === '42P01' || c === 'PGRST205' || /does not exist|schema cache/i.test(m)) return 'Chưa có bảng dữ liệu. Hãy chạy supabase.sql trong Supabase SQL Editor.';
    if (c === '23505' || /duplicate key/i.test(m)) return 'Slug hoặc tên đã tồn tại. Hãy dùng giá trị khác.';
    if (c === '23514') return 'Dữ liệu không hợp lệ (vi phạm ràng buộc của bảng).';
    return 'Đã xảy ra lỗi: ' + m;
  }

  /* ===== 3. SUPABASE CLIENT & TRUY VẤN ===== */
  let client = null;
  let clientError = null;

  function looksSecret(key) {
    if (/^sb_secret_/.test(key)) return true;
    try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; }
    catch (_) { return false; }
  }

  function isConfigured() {
    return /^https?:\/\//i.test(SUPABASE_URL) && !/YOUR-/.test(SUPABASE_URL + SUPABASE_ANON_KEY) && SUPABASE_ANON_KEY.length > 20;
  }

  function initClient() {
    if (!isConfigured()) { clientError = 'Chưa cấu hình Supabase. Điền SUPABASE_URL và SUPABASE_ANON_KEY ở đầu file script.js.'; return; }
    if (looksSecret(SUPABASE_ANON_KEY)) { clientError = 'Đây là khóa bí mật (service_role/secret). Không dùng ở frontend. Hãy dùng anon/publishable key.'; return; }
    if (!window.supabase || !window.supabase.createClient) { clientError = 'Không tải được Supabase SDK từ CDN. Kiểm tra kết nối mạng.'; return; }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
  }

  async function run(query) {
    try {
      const { data, error, count } = await query;
      if (error) throw error;
      return { data, count, error: null };
    } catch (e) {
      console.error('[NamouSI]', e);
      return { data: null, count: null, error: friendlyError(e) };
    }
  }

  const db = {
    listPublished(table, o = {}) {
      let q = client.from(table).select(o.select || '*').eq('status', 'published');
      Object.entries(o.eq || {}).forEach(([k, v]) => { q = q.eq(k, v); });
      return run(q.order(o.order || 'created_at', { ascending: !!o.asc, nullsFirst: false }).limit(o.limit || 6));
    },
    list: (table, limit = 50) => run(client.from(table).select('*').order('updated_at', { ascending: false }).limit(limit)),
    count: table => run(client.from(table).select('*', { count: 'exact', head: true }))
  };

  /* ===== 4. WEBSITE PUBLIC ===== */
  const PRICING = { free: 'Miễn phí', freemium: 'Freemium', paid: 'Trả phí', open_source: 'Mã nguồn mở' };
  const TOOL_COLS = 'id,name,slug,tagline,logo_url,pricing_model,is_featured';

  const cardCategory = c => `<article class="card pub-card"><div class="pub-card-media">${safeUrl(c.icon) ? `<img src="${esc(safeUrl(c.icon))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(c.icon || (c.name || '?').charAt(0).toUpperCase())}</div><h3>${esc(c.name)}</h3><p class="pub-card-text">${esc(c.description || '')}</p><div class="pub-card-meta"><button class="btn btn-sm" type="button" data-cat="${esc(c.id)}" data-name="${esc(c.name)}">Xem AI</button></div></article>`;
  const cardTool = t => {
    const logo = safeUrl(t.logo_url);
    return `<article class="card pub-card"><div class="pub-card-media">${logo ? `<img src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc((t.name || '?').charAt(0).toUpperCase())}</div><h3>${esc(t.name)}</h3><p class="pub-card-text">${esc(t.tagline || '')}</p><div class="pub-card-meta">${t.pricing_model ? `<span class="badge">${esc(PRICING[t.pricing_model] || t.pricing_model)}</span>` : ''}<button class="btn btn-sm" type="button" data-tool="${esc(t.slug)}">Chi tiết</button></div></article>`;
  };
  const cardPrompt = p => `<article class="card pub-card"><h3>${esc(p.title)}</h3><p class="pub-card-text">${esc(p.description || '')}</p><div class="pub-card-meta"><button class="btn btn-sm" type="button" data-prompt="${esc(p.slug)}">Xem &amp; sao chép</button></div></article>`;
  const cardNews = n => {
    const cover = safeUrl(n.cover_url), src = safeUrl(n.source_url);
    return `<article class="card pub-card">${cover ? `<img class="pub-card-cover" src="${esc(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<h3>${esc(n.title)}</h3><p class="pub-card-text">${esc(n.summary || '')}</p><div class="pub-card-meta"><span>${esc(fmtDate(n.published_at).split(',')[0].trim())}</span>${src ? `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer">Đọc nguồn</a>` : ''}</div></article>`;
  };

  const SECTIONS = {
    categories: { table: 'categories', select: 'id,name,description,icon', order: 'sort_order', asc: true, limit: 12, render: cardCategory, empty: 'Chưa có danh mục nào được xuất bản.' },
    featured: { table: 'ai_tools', select: TOOL_COLS, eq: { is_featured: true }, order: 'published_at', render: cardTool, empty: 'Chưa có AI nổi bật nào được xuất bản.' },
    latest: { table: 'ai_tools', select: TOOL_COLS, order: 'updated_at', render: cardTool, empty: 'Chưa có AI nào được cập nhật.' },
    popular: { table: 'ai_tools', select: TOOL_COLS, order: 'view_count', render: cardTool, empty: 'Chưa có AI phổ biến nào.' },
    prompts: { table: 'prompts', select: 'id,title,slug,description', eq: { is_featured: true }, order: 'published_at', render: cardPrompt, empty: 'Chưa có Prompt nổi bật nào được xuất bản.' },
    news: { table: 'news_articles', select: 'id,title,summary,cover_url,source_url,published_at', order: 'published_at', render: cardNews, empty: 'Chưa có tin tức nào được xuất bản.' }
  };

  async function loadSection(el) {
    const cfg = SECTIONS[el.dataset.section];
    if (!cfg) return;
    if (!client) { el.innerHTML = stateHTML('error', clientError); return; }
    el.innerHTML = stateHTML('loading', 'Đang tải dữ liệu...');
    const { data, error } = await db.listPublished(cfg.table, cfg);
    if (error) el.innerHTML = stateHTML('error', error);
    else el.innerHTML = data.length ? data.map(cfg.render).join('') : stateHTML('empty', cfg.empty);
  }

  async function onSearch(e) {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    const wrap = $('#search-results'), box = $('#searchBox');
    wrap.hidden = false;
    $('#searchTitle').textContent = q ? `Kết quả cho “${q}”` : 'Kết quả tìm kiếm';
    wrap.scrollIntoView({ block: 'start' });
    if (q.length < 2) { box.innerHTML = stateHTML('error', 'Nhập ít nhất 2 ký tự để tìm kiếm.'); return; }
    if (!client) { box.innerHTML = stateHTML('error', clientError); return; }
    box.innerHTML = stateHTML('loading', 'Đang tìm kiếm...');
    const { data, error } = await run(
      client.from('ai_tools').select(TOOL_COLS).eq('status', 'published')
        .ilike('name', `%${q.replace(/[%_\\]/g, '\\$&')}%`).order('name').limit(24)
    );
    if (error) box.innerHTML = stateHTML('error', error);
    else box.innerHTML = data.length ? data.map(cardTool).join('') : stateHTML('empty', 'Không tìm thấy công cụ AI phù hợp.');
  }

  /* --- Chi tiết công khai (modal): AI, Prompt, lọc theo danh mục --- */
  const openPub = (t, h) => { $('#pubTitle').textContent = t; $('#pubBody').innerHTML = h; $('#pubModal').hidden = false; };
  const lst = a => (Array.isArray(a) && a.length ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  const para = x => (x ? `<p class="pre-wrap">${esc(x)}</p>` : '');
  const blk = (t, h) => (h ? `<h3>${esc(t)}</h3>${h}` : '');
  const chips = rows => (rows || []).map(r => r.tags ? `<span class="badge">${esc(r.tags.name)}</span>` : '').join(' ');
  const lines = x => String(x || '').split('\n').map(v => v.trim()).filter(Boolean);

  async function showTool(slug) {
    openPub('Đang tải...', stateHTML('loading', 'Đang tải chi tiết...'));
    if (!client) return openPub('Lỗi', stateHTML('error', clientError));
    const { data: t, error } = await run(client.from('ai_tools').select('*, categories(name), ai_tool_tags(tags(name))').eq('slug', slug).eq('status', 'published').maybeSingle());
    if (error || !t) return openPub('Không tìm thấy', stateHTML(error ? 'error' : 'empty', error || 'AI này không tồn tại hoặc chưa được xuất bản.'));
    const sim = t.category_id ? ((await run(client.from('ai_tools').select(TOOL_COLS).eq('status', 'published').eq('category_id', t.category_id).neq('id', t.id).limit(4))).data || []) : [];
    const site = safeUrl(t.website_url), logo = safeUrl(t.logo_url);
    const shots = (t.screenshot_urls || []).filter(safeUrl).map(u => `<img class="pub-card-cover" src="${esc(u)}" alt="Ảnh giao diện ${esc(t.name)}" loading="lazy" referrerpolicy="no-referrer">`).join('');
    const src = lines(t.sources).map(u => safeUrl(u) ? `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a></li>` : `<li>${esc(u)}</li>`).join('');
    openPub(t.name, `<div class="pub-detail">${logo ? `<div class="pub-card-media"><img src="${esc(logo)}" alt="" referrerpolicy="no-referrer"></div>` : ''}<p class="muted">${esc(t.tagline || '')}</p>
      <div class="pub-card-meta">${t.pricing_model ? `<span class="badge">${esc(PRICING[t.pricing_model] || t.pricing_model)}</span>` : ''}${t.categories ? `<span class="badge">${esc(t.categories.name)}</span>` : ''}${chips(t.ai_tool_tags)}${t.developer ? `<span>Nhà phát triển: ${esc(t.developer)}</span>` : ''}</div>
      ${para(t.description)}${site ? `<p><a class="btn btn-primary btn-sm" href="${esc(site)}" target="_blank" rel="noopener noreferrer">Truy cập website</a></p>` : ''}
      ${blk('Giá và giới hạn gói', para(t.pricing_notes))}${blk('Tính năng', lst(t.features))}${blk('Ưu điểm', lst(t.pros))}${blk('Nhược điểm', lst(t.cons))}${blk('Nền tảng hỗ trợ', lst(t.platforms))}${blk('API', para(t.api_info))}${blk('Ảnh giao diện', shots)}${blk('Nguồn tham khảo', src && `<ul>${src}</ul>`)}${t.verified_at ? `<p class="muted">Ngày xác minh: ${esc(t.verified_at)}</p>` : ''}${blk('AI tương tự', sim.length ? `<div class="grid">${sim.map(cardTool).join('')}</div>` : '')}</div>`);
  }

  async function showPrompt(slug) {
    openPub('Đang tải...', stateHTML('loading', 'Đang tải Prompt...'));
    if (!client) return openPub('Lỗi', stateHTML('error', clientError));
    const { data: p, error } = await run(client.from('prompts').select('*, categories(name), ai_tools(name), prompt_tags(tags(name))').eq('slug', slug).eq('status', 'published').maybeSingle());
    if (error || !p) return openPub('Không tìm thấy', stateHTML(error ? 'error' : 'empty', error || 'Prompt này không tồn tại hoặc chưa được xuất bản.'));
    openPub(p.title, `<div class="pub-detail"><p class="muted">${esc(p.description || '')}</p>
      <div class="pub-card-meta">${p.categories ? `<span class="badge">${esc(p.categories.name)}</span>` : ''}${p.ai_tools ? `<span class="badge">${esc(p.ai_tools.name)}</span>` : ''}${chips(p.prompt_tags)}<span>Phiên bản ${esc(p.version || '1.0')}</span></div>
      <h3>Nội dung Prompt</h3><pre class="pub-pre" id="promptText">${esc(p.content)}</pre>
      <p><button class="btn btn-primary btn-sm" type="button" data-copy>Sao chép Prompt</button></p>
      ${blk('Biến đầu vào', lst(p.variables))}${blk('Hướng dẫn sử dụng', para(p.usage_guide))}${blk('Ví dụ', para(p.example))}</div>`);
  }

  async function copyPrompt(btn) {
    const el = $('#promptText');
    try { await navigator.clipboard.writeText(el.textContent); btn.textContent = 'Đã sao chép ✓'; }
    catch (_) { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); btn.textContent = 'Đã chọn sẵn – nhấn Ctrl+C'; }
  }

  async function byCategory(id, name) {
    const wrap = $('#search-results'), box = $('#searchBox');
    wrap.hidden = false;
    $('#searchTitle').textContent = `AI thuộc danh mục “${name}”`;
    wrap.scrollIntoView({ block: 'start' });
    if (!client) { box.innerHTML = stateHTML('error', clientError); return; }
    box.innerHTML = stateHTML('loading', 'Đang tải...');
    const { data, error } = await run(client.from('ai_tools').select(TOOL_COLS).eq('status', 'published').eq('category_id', id).order('name').limit(24));
    box.innerHTML = error ? stateHTML('error', error) : data.length ? data.map(cardTool).join('') : stateHTML('empty', 'Danh mục này chưa có AI nào được xuất bản.');
  }

  function initPublic() {
    const btn = $('#menuBtn'), nav = $('#mainNav');
    const setMenu = open => { nav.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
    nav.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
    $('#searchForm').addEventListener('submit', onSearch);
    $('#closeSearch').addEventListener('click', () => { $('#search-results').hidden = true; $('#searchInput').value = ''; });
    $('#year').textContent = new Date().getFullYear();
    $$('[data-section]').forEach(loadSection);
    document.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.hidden = true; }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#pubModal').hidden = true; });
    document.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) { $('#pubModal').hidden = true; return; }
      const b = e.target.closest('[data-tool],[data-prompt],[data-copy],[data-cat]');
      if (!b) return;
      if (b.dataset.tool) showTool(b.dataset.tool);
      else if (b.dataset.prompt) showPrompt(b.dataset.prompt);
      else if (b.dataset.cat) byCategory(b.dataset.cat, b.dataset.name || '');
      else copyPrompt(b);
    });
  }

  /* ===== 5. KHỞI CHẠY ===== */
  document.addEventListener('DOMContentLoaded', () => { initClient(); initPublic(); });
})();
