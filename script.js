/* =====================================================================
   NamouSI – script.js (dùng chung cho index.html và admin/index.html)
   Trang được nhận diện qua <body data-page="public|admin">.
   Logic Admin chỉ chạy khi data-page="admin".
   ===================================================================== */
(() => {
  'use strict';

  /* ===== 1. CẤU HÌNH – điền 2 giá trị dưới đây =====
     Lấy tại Supabase → Project Settings → API:
       - Project URL
       - anon / publishable key (khóa CÔNG KHAI)
     TUYỆT ĐỐI KHÔNG dán service_role / secret key vào đây. */
  const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
  const SUPABASE_ANON_KEY = 'YOUR-ANON-OR-PUBLISHABLE-KEY';

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
    if (/bucket not found/i.test(m)) return 'Chưa có bucket ai-media. Hãy chạy supabase.sql.';
    if (/mime type|maximum allowed size/i.test(m)) return 'Ảnh không hợp lệ (chỉ PNG/JPG/WebP, tối đa 2 MB).';
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

  const cardCategory = c => `<article class="card pub-card"><div class="pub-card-media">${esc(c.icon || (c.name || '?').charAt(0).toUpperCase())}</div><h3>${esc(c.name)}</h3><p class="pub-card-text">${esc(c.description || '')}</p><div class="pub-card-meta"><button class="btn btn-sm" type="button" data-cat="${esc(c.id)}" data-name="${esc(c.name)}">Xem AI</button></div></article>`;
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

  /* ===== 5. WEBSITE ADMIN ===== */
  const A = { isAdmin: false, uid: null, rows: {}, ref: { cat: [], tag: [], tool: [] } };
  const VIEWS = { dashboard: 'Tổng quan', ai: 'Quản lý AI', categories: 'Danh mục', tags: 'Tag', prompts: 'Prompt', news: 'Tin tức', users: 'Người dùng', reviews: 'Đánh giá', settings: 'Cài đặt Supabase' };
  const STATS = [['ai_tools', 'AI'], ['ai_models', 'Model AI'], ['categories', 'Danh mục'], ['tags', 'Tag'], ['prompts', 'Prompt'], ['news_articles', 'Tin tức'], ['profiles', 'Người dùng']];
  const UPDATED = ['updated_at', 'Cập nhật'];
  const ST = [['draft', 'Nháp / ẩn'], ['published', 'Xuất bản'], ['archived', 'Lưu trữ']];
  const PM = [['', '— Chưa chọn —'], ['free', 'Miễn phí'], ['freemium', 'Freemium'], ['paid', 'Trả phí'], ['open_source', 'Mã nguồn mở']];
  const BUCKET = 'ai-media';
  // Kiểu field: t text | x textarea | l danh sách (mỗi dòng 1 mục) | u url | img url + upload | slug | n số | d ngày | s select | b checkbox
  const F = (k, l, t = 't', o = {}) => ({ k, l, t, ...o });
  const fStatus = F('status', 'Trạng thái', 's', { opts: ST, req: 1, def: 'draft' });
  const MODULES = {
    ai: { table: 'ai_tools', title: 'name', by: 1, pub: 1, folder: 'logos', link: { table: 'ai_tool_tags', fk: 'ai_tool_id' },
      cols: [['name', 'Tên'], ['slug', 'Slug'], ['status', 'Trạng thái'], UPDATED], empty: 'Chưa có công cụ AI nào.',
      fields: [F('name', 'Tên AI', 't', { req: 1, max: 120 }), F('slug', 'Slug', 'slug', { max: 80 }), F('tagline', 'Mô tả ngắn', 't', { max: 200 }), F('description', 'Mô tả đầy đủ', 'x', { max: 8000 }),
        F('logo_url', 'Logo (URL hoặc tải ảnh lên)', 'img'), F('screenshot_urls', 'Ảnh giao diện (mỗi dòng 1 URL, tối đa 20)', 'l', { url: 1 }),
        F('website_url', 'Website chính thức', 'u'), F('developer', 'Nhà phát triển', 't', { max: 120 }),
        F('category_id', 'Danh mục', 's', { opts: 'cat' }), F('pricing_model', 'Loại giá', 's', { opts: PM }),
        F('platforms', 'Nền tảng hỗ trợ (mỗi dòng 1 mục)', 'l'), F('features', 'Tính năng (mỗi dòng 1 mục)', 'l'), F('pros', 'Ưu điểm (mỗi dòng 1 mục)', 'l'), F('cons', 'Nhược điểm (mỗi dòng 1 mục)', 'l'),
        F('api_info', 'API', 't', { max: 300 }), F('pricing_notes', 'Giá và giới hạn gói', 'x', { max: 4000 }), F('sources', 'Nguồn tham khảo (mỗi dòng 1 mục)', 'x', { max: 3000 }), F('verified_at', 'Ngày xác minh', 'd'),
        F('is_featured', 'Đánh dấu nổi bật', 'b'), fStatus] },
    categories: { table: 'categories', title: 'name',
      cols: [['name', 'Tên'], ['slug', 'Slug'], ['status', 'Trạng thái'], UPDATED], empty: 'Chưa có danh mục nào.',
      fields: [F('name', 'Tên danh mục', 't', { req: 1, max: 80 }), F('slug', 'Slug', 'slug', { max: 80 }), F('description', 'Mô tả', 'x', { max: 500 }), F('icon', 'Biểu tượng (emoji hoặc chữ ngắn)', 't', { max: 8 }),
        F('parent_id', 'Danh mục cha', 's', { opts: 'cat' }), F('sort_order', 'Thứ tự', 'n', { def: 0 }), fStatus] },
    tags: { table: 'tags', title: 'name', cols: [['name', 'Tên'], ['slug', 'Slug'], UPDATED], empty: 'Chưa có tag nào.',
      fields: [F('name', 'Tên tag', 't', { req: 1, max: 60 }), F('slug', 'Slug', 'slug', { max: 60 })] },
    prompts: { table: 'prompts', title: 'title', by: 1, pub: 1, link: { table: 'prompt_tags', fk: 'prompt_id' },
      cols: [['title', 'Tiêu đề'], ['status', 'Trạng thái'], UPDATED], empty: 'Chưa có Prompt nào.',
      fields: [F('title', 'Tên Prompt', 't', { req: 1, max: 160 }), F('slug', 'Slug', 'slug', { max: 80 }), F('description', 'Mô tả', 'x', { max: 600 }), F('content', 'Nội dung Prompt', 'x', { req: 1, max: 20000 }),
        F('category_id', 'Danh mục', 's', { opts: 'cat' }), F('ai_tool_id', 'AI / model tương thích', 's', { opts: 'tool' }),
        F('variables', 'Biến đầu vào (mỗi dòng 1 biến)', 'l'), F('usage_guide', 'Hướng dẫn sử dụng', 'x', { max: 3000 }), F('example', 'Ví dụ sử dụng', 'x', { max: 5000 }),
        F('version', 'Phiên bản', 't', { req: 1, max: 20, def: '1.0' }), F('is_featured', 'Đánh dấu nổi bật', 'b'), fStatus] },
    news: { table: 'news_articles', title: 'title', by: 1, pub: 1, folder: 'covers',
      cols: [['title', 'Tiêu đề'], ['status', 'Trạng thái'], UPDATED], empty: 'Chưa có bài viết nào.',
      fields: [F('title', 'Tiêu đề', 't', { req: 1, max: 200 }), F('slug', 'Slug', 'slug', { max: 80 }), F('summary', 'Tóm tắt', 'x', { max: 600 }), F('content', 'Nội dung', 'x', { max: 30000 }),
        F('cover_url', 'Ảnh đại diện (URL hoặc tải ảnh lên)', 'img'), F('source_url', 'Nguồn', 'u'), F('is_featured', 'Đánh dấu nổi bật', 'b'), fStatus] }
  };

  const showScreen = name => {
    $('#screenLoading').hidden = name !== 'loading';
    $('#loginView').hidden = name !== 'login';
    $('#appView').hidden = name !== 'app';
  };
  function setLoginError(msg) {
    const el = $('#loginError');
    el.hidden = !msg;
    el.innerHTML = msg ? `<p>${esc(msg)}</p>` : '';
  }

  async function checkAdmin(uid) {
    const r = await run(client.from('user_roles').select('role').eq('user_id', uid).eq('role', 'admin').limit(1));
    return { error: r.error, isAdmin: !!(r.data && r.data.length) };
  }

  async function routeSession(session) {
    if (!session) { showScreen('login'); return; }
    const r = await checkAdmin(session.user.id);
    if (r.error || !r.isAdmin) {
      await client.auth.signOut();
      showScreen('login');
      setLoginError(r.error || 'Tài khoản này không có quyền quản trị.');
      return;
    }
    A.isAdmin = true; A.uid = session.user.id;
    $('#userEmail').textContent = session.user.email || '';
    showScreen('app');
    setView(location.hash.slice(1));
  }

  async function onLogin(e) {
    e.preventDefault();
    const email = $('#loginEmail').value.trim(), pw = $('#loginPassword').value, btn = $('#loginBtn');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setLoginError('Email không hợp lệ.');
    if (pw.length < 6) return setLoginError('Mật khẩu phải có ít nhất 6 ký tự.');
    setLoginError('');
    btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
      await routeSession(data.session);
    } catch (err) {
      setLoginError(friendlyError(err));
    } finally {
      btn.disabled = false; btn.textContent = 'Đăng nhập';
      $('#loginPassword').value = '';
    }
  }

  async function onLogout() {
    A.isAdmin = false; A.rows = {};
    try { await client.auth.signOut(); } catch (e) { console.error('[NamouSI]', e); }
    setLoginError('');
    showScreen('login');
  }

  function setView(name) {
    if (!VIEWS[name]) name = 'dashboard';
    $$('[data-view]').forEach(s => { s.hidden = s.dataset.view !== name; });
    $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
    $('#viewTitle').textContent = VIEWS[name];
    $('#sidebar').classList.remove('open');
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
    if (name === 'dashboard') loadStats();
    else if (MODULES[name]) loadList(name);
    else if (name === 'settings') renderSettings();
  }

  async function loadStats() {
    const grid = $('#statGrid');
    grid.innerHTML = stateHTML('loading', 'Đang tải số liệu...');
    const res = await Promise.all(STATS.map(s => db.count(s[0])));
    const firstErr = res.find(r => r.error);
    grid.innerHTML = STATS.map((s, i) =>
      `<div class="card"><span class="stat-label">${esc(s[1])}</span><strong class="stat-value">${res[i].error ? '—' : res[i].count ?? 0}</strong></div>`
    ).join('') + (firstErr ? stateHTML('error', firstErr.error) : '');
  }

  function cell(key, val) {
    if (key === 'status') return `<span class="badge badge-${esc(val)}">${esc(val)}</span>`;
    if (/_at$/.test(key)) return esc(fmtDate(val));
    return esc(val ?? '—');
  }

  const slugify = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

  async function loadRefs() {
    const [c, t, a] = await Promise.all([
      run(client.from('categories').select('id,name').order('name').limit(500)),
      run(client.from('tags').select('id,name').order('name').limit(500)),
      run(client.from('ai_tools').select('id,name').order('name').limit(500))]);
    A.ref = { cat: c.data || [], tag: t.data || [], tool: a.data || [] };
  }

  async function loadList(name) {
    const m = MODULES[name], box = $(`[data-list="${name}"]`);
    box.innerHTML = stateHTML('loading', 'Đang tải dữ liệu...');
    const [r] = await Promise.all([db.list(m.table, 200), loadRefs()]);
    if (r.error) { box.innerHTML = stateHTML('error', r.error); return; }
    A.rows[name] = r.data;
    const fc = $(`[data-view="${name}"] [data-fc]`);
    if (fc) fc.innerHTML = '<option value="">Mọi danh mục</option>' + A.ref.cat.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    renderList(name);
  }

  function renderList(name) {
    const m = MODULES[name], box = $(`[data-list="${name}"]`), sec = box.closest('[data-view]');
    const val = s => { const e = $(s, sec); return e ? e.value : ''; };
    const q = val('[data-q]').trim().toLowerCase(), fs = val('[data-fs]'), fc = val('[data-fc]');
    const all = A.rows[name] || [];
    const rows = all.map((r, i) => [r, i]).filter(([r]) => (!q || [r[m.title], r.slug].some(x => String(x || '').toLowerCase().includes(q))) && (!fs || r.status === fs) && (!fc || r.category_id === fc));
    if (!rows.length) { box.innerHTML = stateHTML('empty', all.length ? 'Không có mục nào khớp bộ lọc.' : m.empty); return; }
    box.innerHTML = `<table class="table"><thead><tr>${m.cols.map(c => `<th>${esc(c[1])}</th>`).join('')}<th></th></tr></thead><tbody>${
      rows.map(([r, i]) => `<tr>${m.cols.map(c => `<td>${cell(c[0], r[c[0]])}</td>`).join('')}<td><div class="adm-actions"><button class="btn btn-sm" type="button" data-edit="${i}">Sửa</button><button class="btn btn-sm" type="button" data-del="${i}">Xóa</button></div></td></tr>`).join('')
    }</tbody></table>`;
  }

  function fieldHTML(f, v, row) {
    const n = esc(f.k), L = esc(f.l) + (f.req ? ' *' : ''), mx = f.max ? ` maxlength="${f.max}"` : '';
    if (f.t === 'b') return `<label class="field adm-check"><input type="checkbox" name="${n}"${v ? ' checked' : ''}> ${L}</label>`;
    let ctl;
    if (f.t === 'x' || f.t === 'l') ctl = `<textarea class="input" name="${n}" rows="${f.t === 'l' ? 3 : 5}"${mx}>${esc(Array.isArray(v) ? v.join('\n') : v)}</textarea>`;
    else if (f.t === 's') {
      const o = f.opts === 'cat' ? [['', '— Không chọn —'], ...A.ref.cat.filter(c => !row || c.id !== row.id).map(c => [c.id, c.name])]
        : f.opts === 'tool' ? [['', '— Không chọn —'], ...A.ref.tool.map(c => [c.id, c.name])] : f.opts;
      ctl = `<select class="input" name="${n}">${o.map(([k, t]) => `<option value="${esc(k)}"${(v ?? '') === k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    } else {
      const type = { u: 'url', img: 'url', d: 'date', n: 'number' }[f.t] || 'text';
      ctl = `<input class="input" name="${n}" type="${type}"${mx}${f.t === 'slug' ? ' placeholder="Để trống để tự tạo từ tên"' : ''} value="${esc(f.t === 'd' ? String(v || '').slice(0, 10) : v)}">`;
    }
    if (f.t === 'img') ctl += `<input class="input" type="file" accept="image/png,image/jpeg,image/webp" data-upload="${n}"><span class="muted" data-upstat>PNG, JPG hoặc WebP, tối đa 2 MB.</span>`;
    return `<label class="field">${L}${ctl}</label>`;
  }

  function readForm(m, form) {
    const v = {}, errs = [];
    m.fields.forEach(f => {
      const el = form.elements[f.k];
      if (f.t === 'b') { v[f.k] = el.checked; return; }
      let x = el.value.trim();
      if (f.t === 'l') {
        x = x.split('\n').map(i => i.trim()).filter(Boolean);
        if (x.length > 20) errs.push(`${f.l}: tối đa 20 dòng.`);
        if (x.some(i => i.length > 300 || (f.url && !safeUrl(i)))) errs.push(f.url ? `${f.l}: mỗi dòng phải là URL http(s).` : `${f.l}: mỗi dòng tối đa 300 ký tự.`);
        v[f.k] = x; return;
      }
      if (f.t === 'slug' && !x) x = slugify(v[m.title]);
      if (f.req && !x) errs.push(`${f.l} là bắt buộc.`);
      if (f.max && x.length > f.max) errs.push(`${f.l} tối đa ${f.max} ký tự.`);
      if (x && (f.t === 'u' || f.t === 'img') && !safeUrl(x)) errs.push(`${f.l} phải là URL bắt đầu bằng http:// hoặc https://.`);
      if (f.t === 'slug' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(x)) errs.push('Slug chỉ gồm chữ thường, số và dấu gạch ngang (không được để trống).');
      if (f.t === 'n') { const num = Number(x || 0); if (!Number.isInteger(num) || num < 0 || num > 9999) errs.push(`${f.l} phải là số nguyên từ 0 đến 9999.`); x = num; }
      v[f.k] = x === '' ? null : x;
    });
    return { v, errs };
  }

  const formError = msg => { const e = $('#formError'); if (e) { e.hidden = !msg; e.innerHTML = msg ? `<p>${esc(msg)}</p>` : ''; if (msg) e.scrollIntoView({ block: 'nearest' }); } };

  async function openForm(name, idx) {
    const m = MODULES[name], row = idx == null ? null : (A.rows[name] || [])[idx], body = $('#modalBody');
    $('#modalTitle').textContent = row ? 'Sửa: ' + (row[m.title] || '') : 'Thêm mới';
    body.innerHTML = stateHTML('loading', 'Đang tải biểu mẫu...');
    $('#modal').hidden = false;
    const ctx = { id: row && row.id, row, linked: [] };
    if (row && m.link) {
      const r = await run(client.from(m.link.table).select('tag_id').eq(m.link.fk, row.id));
      if (r.error) { body.innerHTML = stateHTML('error', r.error); return; }
      ctx.linked = r.data.map(x => x.tag_id);
    }
    const tags = m.link ? `<fieldset class="field"><legend>Tag</legend><div class="chips">${A.ref.tag.length ? A.ref.tag.map(t => `<label class="chip"><input type="checkbox" name="_tags" value="${esc(t.id)}"${ctx.linked.includes(t.id) ? ' checked' : ''}> ${esc(t.name)}</label>`).join('') : '<span class="muted">Chưa có tag. Hãy tạo ở mục Tag.</span>'}</div></fieldset>` : '';
    body.innerHTML = `<form id="crudForm" novalidate><div class="state state-error" id="formError" role="alert" hidden></div>${m.fields.map(f => fieldHTML(f, row ? row[f.k] : f.def, row)).join('')}${tags}<div class="adm-form-actions"><button class="btn" type="button" data-close>Hủy</button><button class="btn btn-primary" type="submit">Lưu</button></div></form>`;
    const form = $('#crudForm');
    form.addEventListener('submit', e => { e.preventDefault(); saveForm(name, ctx, form); });
    form.addEventListener('change', e => { if (e.target.matches('[data-upload]')) onUpload(e.target, m.folder || 'misc'); });
  }

  async function uploadImage(file, folder) {
    const bad = msg => Object.assign(new Error(msg), { ui: msg });
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw bad('Chỉ nhận ảnh PNG, JPG hoặc WebP.');
    if (file.size > 2 * 1024 * 1024) throw bad('Ảnh vượt quá 2 MB.');
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'}`;
    const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function onUpload(inp, folder) {
    const file = inp.files[0], st = inp.parentElement.querySelector('[data-upstat]');
    if (!file) return;
    st.textContent = 'Đang tải ảnh lên...'; inp.disabled = true; formError('');
    try {
      $(`#crudForm [name="${inp.dataset.upload}"]`).value = await uploadImage(file, folder);
      st.textContent = 'Đã tải lên. Nhớ bấm Lưu.';
    } catch (e) { st.textContent = ''; formError(e.ui || friendlyError(e)); }
    inp.disabled = false; inp.value = '';
  }

  async function saveForm(name, ctx, form) {
    const m = MODULES[name], btn = $('button[type="submit"]', form), { v, errs } = readForm(m, form);
    if (errs.length) return formError(errs.join(' '));
    formError('');
    btn.disabled = true; btn.textContent = 'Đang lưu...';
    const fail = msg => { formError(msg); btn.disabled = false; btn.textContent = 'Lưu'; };
    if (m.pub && v.status === 'published' && !(ctx.row && ctx.row.published_at)) v.published_at = new Date().toISOString();
    let r;
    if (ctx.id) r = await run(client.from(m.table).update(v).eq('id', ctx.id).select('id').single());
    else { if (m.by) v.created_by = A.uid; r = await run(client.from(m.table).insert(v).select('id').single()); }
    if (r.error) return fail(r.error);
    ctx.id = r.data.id;
    if (m.link) {
      const ids = $$('input[name="_tags"]:checked', form).map(i => i.value);
      const del = ctx.linked.filter(t => !ids.includes(t)), add = ids.filter(t => !ctx.linked.includes(t));
      let e = null;
      if (del.length) e = (await run(client.from(m.link.table).delete().eq(m.link.fk, ctx.id).in('tag_id', del))).error;
      if (!e && add.length) e = (await run(client.from(m.link.table).insert(add.map(t => ({ [m.link.fk]: ctx.id, tag_id: t }))))).error;
      if (e) { loadList(name); return fail('Đã lưu nội dung nhưng gắn tag bị lỗi: ' + e); }
    }
    closeModal();
    loadList(name);
  }

  async function delRow(name, idx) {
    const m = MODULES[name], row = (A.rows[name] || [])[idx];
    if (!row || !confirm(`Xóa “${row[m.title]}”? Thao tác này không thể hoàn tác.`)) return;
    const r = await run(client.from(m.table).delete().eq('id', row.id).select('id'));
    if (r.error) alert(r.error);
    else if (!r.data.length) alert('Không xóa được (không có quyền hoặc mục đã bị xóa).');
    loadList(name);
  }
  const closeModal = () => { $('#modal').hidden = true; };

  async function renderSettings() {
    let host = '—';
    try { host = new URL(SUPABASE_URL).host; } catch (_) { /* giữ mặc định */ }
    $('#cfgUrl').textContent = host;
    $('#cfgKey').textContent = isConfigured() ? 'Đã nhập (khóa công khai)' : 'Chưa nhập';
    const { data } = await client.auth.getUser();
    $('#cfgUser').textContent = (data && data.user && data.user.email) || '—';
  }

  async function testConnection() {
    const out = $('#testResult'), btn = $('#testBtn');
    btn.disabled = true;
    out.innerHTML = stateHTML('loading', 'Đang kiểm tra kết nối...');
    const r = await db.count('categories');
    out.innerHTML = r.error ? stateHTML('error', r.error) : stateHTML('ok', 'Kết nối thành công. Đọc được bảng categories.');
    btn.disabled = false;
  }

  async function initAdmin() {
    if (!$('#appView')) return;
    $('#loginForm').addEventListener('submit', onLogin);
    $('#logoutBtn').addEventListener('click', onLogout);
    $('#testBtn').addEventListener('click', testConnection);
    $('#sidebarBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#modal').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    ['input', 'change'].forEach(ev => $('#appView').addEventListener(ev, e => {
      const sec = e.target.closest('[data-view]');
      if (sec && e.target.matches('[data-q],[data-fs],[data-fc]') && MODULES[sec.dataset.view] && A.rows[sec.dataset.view]) renderList(sec.dataset.view);
    }));
    window.addEventListener('hashchange', () => { if (A.isAdmin) setView(location.hash.slice(1)); });
    $('#appView').addEventListener('click', e => {
      const nav = e.target.closest('[data-nav],[data-refresh]');
      if (nav) return setView(nav.dataset.nav || nav.dataset.refresh);
      const act = e.target.closest('[data-add],[data-edit],[data-del]');
      if (!act) return;
      const name = act.dataset.add || act.closest('[data-view]').dataset.view;
      if (act.dataset.add) openForm(name);
      else if (act.dataset.edit !== undefined) openForm(name, Number(act.dataset.edit));
      else delRow(name, Number(act.dataset.del));
    });

    if (!client) {
      showScreen('login');
      setLoginError(clientError);
      $('#loginBtn').disabled = true;
      return;
    }
    // Đăng xuất / hết phiên ở tab khác hoặc token hết hạn → quay về màn đăng nhập
    client.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT' && A.isAdmin) { A.isAdmin = false; showScreen('login'); }
    });
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      await routeSession(data.session);
    } catch (e) {
      showScreen('login');
      setLoginError(friendlyError(e));
    }
  }

  /* ===== 6. KHỞI CHẠY ===== */
  document.addEventListener('DOMContentLoaded', () => {
    initClient();
    const page = document.body.dataset.page;
    if (page === 'public') initPublic();
    else if (page === 'admin') initAdmin();
  });
})();
