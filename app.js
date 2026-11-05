'use strict';

/* ===================== 纯数据层（node 可 require） ===================== */

const BRAND_NAMES = {
  anthropic:'Anthropic', openai:'OpenAI', google:'Google', xai:'xAI', deepseek:'DeepSeek',
  zhipuai:'智谱 GLM', 'moonshotai-cn':'Moonshot Kimi', qwen:'Qwen', minimax:'MiniMax',
  xiaomi:'Xiaomi MiMo', typesafe:'TypeSafe'
};
const EP_LABELS = {
  openai:'Chat', 'openai-response':'Responses', 'anthropic-messages':'Anthropic',
  'google-gemini':'Gemini', 'openai-image':'Image', 'openai-embedding':'Embedding', systemone:'SystemOne'
};
const CAPS = [
  ['reasoning','推理','spark'], ['tool_calling','工具调用','wrench'], ['structured_output','结构化输出','braces'],
  ['image_input','图像输入','image'], ['audio_input','音频输入','audio'], ['video_input','视频输入','video']
];
const VARIANT_LABELS = {
  fast:'Fast 模式', ultrafast:'Ultrafast', priority:'Priority', peak:'高峰时段',
  cache_12h:'12 小时缓存', explicit_cache_read:'显式缓存', per_unit:'按单位计费',
  long_context:'长上下文', long_decode:'长输出', extended_output:'扩展输出',
  text_output:'文本输出', image_video_input:'图像/视频输入'
};
const VARIANT_FIELD_LABEL = {cache_write: '缓存写', cache_write_1h: '1h 缓存写', cache_write_12h: '12h 缓存写', explicit_cache_read: '显式缓存读', input_audio: '音频输入', output_thinking: '思考输出', effective_from: '生效', schedule: '时段', per_image: '每张', per_second: '每秒', context_window: '上下文', max_output_tokens: '最大输出', header: '请求头', state_plus_longest_question: 'state+最长问题'};
const VARIANT_OTHER = ['effective_from','schedule','per_image','per_second','context_window','max_output_tokens','header','input_audio','explicit_cache_read','output_thinking','cache_write','cache_write_1h','cache_write_12h','state_plus_longest_question'];
const VARIANT_PRICE = ['input_price','output_price','cache_read'];
const TOKEN_FIELDS = ['context_window','max_output_tokens','state_plus_longest_question'];
const SK_KEYS = ['name','category','status','context_window','max_output_tokens','input_price','output_price','cache_read','endpoints','caps'];

function brandName(k){ return BRAND_NAMES[k] || k; }
function epLabel(k){ return EP_LABELS[k] || k; }
function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtNum(v){
  if (typeof v !== 'number' || !isFinite(v)) return String(v);
  return String(parseFloat(v.toPrecision(10)));
}
function fmtUSD(v){
  if (v == null) return '—';
  if (v === 0) return '免费';
  if (v >= 1) return '$' + v.toFixed(2);
  const s = parseFloat(v.toPrecision(4));
  const d = Math.max(2, (String(s).split('.')[1] || '').length);
  return '$' + s.toFixed(Math.min(d, 8));
}
function trimNum(v, d){ return String(parseFloat(v.toFixed(d))); }
function fmtTokens(n){
  if (n == null) return '—';
  const M = 1048576, K = 1024;
  if (n >= M && n % M === 0) return String(n / M) + 'M';
  if (n >= K && n % K === 0) return String(n / K) + 'K';
  if (n >= 1e6) return trimNum(n / 1e6, 2) + 'M';
  if (n >= 1e3) return trimNum(n / 1e3, 0) + 'K';
  return String(n);
}
function cacheAbs(m, ratio){
  if (ratio == null || m.input_price == null) return null;
  return m.input_price * ratio;
}
function variantLabel(key){
  if (VARIANT_LABELS[key]) return VARIANT_LABELS[key];
  let m = key.match(/^(\w+)_input_over_(\d+)k$/);
  if (m) return (VARIANT_LABELS[m[1]] || m[1]) + ' 输入 > ' + m[2] + 'K';
  m = key.match(/^input_over_(\d+)k$/);
  if (m) return '输入 > ' + m[1] + 'K';
  m = key.match(/^(\w+)_from_(\d{4})_(\d{2})_(\d{2})$/);
  if (m) return (VARIANT_LABELS[m[1]] || m[1]) + ' 自 ' + m[2] + '-' + m[3] + '-' + m[4];
  return key;
}
function variantVal(f, v){
  if (typeof v !== 'number') return String(v);
  return TOKEN_FIELDS.includes(f) ? fmtTokens(v) : fmtUSD(v);
}
function fmtDateLocal(iso){
  const d = new Date(iso), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function flatten(catalog){
  const out = [];
  for (const [bk, b] of Object.entries((catalog && catalog.brands) || {}))
    for (const [mk, m] of Object.entries(b.models || {}))
      out.push({ brand: bk, key: mk, m });
  return out;
}

const it = (o, note) => ({ brand: o.brand, key: o.key, note });
const hasInputOver = m => Object.keys(m.pricing_variants || {}).some(k => /input_over_\d+k$/.test(k));
const hasContextTier = m => ((m.cost && m.cost.tiers) || []).some(t => t && t.tier && t.tier.type === 'context');

const CHECK_RULES = [
  { id:'no_price', title:'在售但无价格', desc:'input_price 或 output_price 为 null',
    fn: models => models
      .filter(o => o.m.status === 'active' && (o.m.input_price == null || o.m.output_price == null))
      .map(o => it(o, 'input_price=' + o.m.input_price + '，output_price=' + o.m.output_price)) },
  { id:'caps_unmarked', title:'capabilities 未标注', desc:'capabilities 为空对象或缺失',
    fn: models => models.filter(o => !o.m.capabilities || !Object.keys(o.m.capabilities).length).map(it) },
  { id:'mods_unmarked', title:'modalities 未标注', desc:'modalities 为空对象或缺失',
    fn: models => models.filter(o => !o.m.modalities || !Object.keys(o.m.modalities).length).map(it) },
  { id:'chat_no_context', title:'chat 类但无 context_window', desc:'chat 类模型缺少上下文窗口',
    fn: models => models.filter(o => o.m.category === 'chat' && o.m.context_window == null).map(it) },
  { id:'tier_mismatch', title:'长上下文价不一致', desc:'xLyra 计费只读 cost.tiers',
    fn: models => models
      .filter(o => hasInputOver(o.m) !== hasContextTier(o.m))
      .map(o => it(o, 'input_over_*：' + hasInputOver(o.m) + '；cost.tiers context 档：' + hasContextTier(o.m))) },
  { id:'mode_mismatch', title:'priority/fast 价不一致', desc:'xLyra 计费只读 experimental.modes.fast.cost',
    fn: models => models
      .filter(o => {
        const pv = o.m.pricing_variants || {};
        const cands = [pv.fast, pv.priority].filter(Boolean);
        const cost = o.m.experimental && o.m.experimental.modes && o.m.experimental.modes.fast && o.m.experimental.modes.fast.cost;
        if (!cands.length) return cost != null;
        if (cost == null) return true;
        return cands.some(v => v.input_price !== cost.input || v.output_price !== cost.output);
      })
      .map(o => it(o, 'pricing_variants: ' + JSON.stringify((o.m.pricing_variants || {}).fast || (o.m.pricing_variants || {}).priority || null) +
        '；modes.fast.cost: ' + JSON.stringify(((((o.m.experimental || {}).modes || {}).fast || {}).cost) || null))) },
  { id:'cache_ratio_missing', title:'缓存价有值但比例为空', desc:'cost.cache_read 有值而 cache_read_ratio 为空',
    fn: models => models
      .filter(o => o.m.cost && o.m.cost.cache_read > 0 && o.m.cache_read_ratio == null)
      .map(o => it(o, 'cost.cache_read=' + o.m.cost.cache_read + '，cache_read_ratio=' + o.m.cache_read_ratio)) },
  { id:'cost_mismatch', title:'cost 与顶层价格不一致', desc:'cost.input/output 应等于 input_price/output_price',
    fn: models => models
      .filter(o => {
        const c = o.m.cost || {};
        return ('input' in c && c.input !== o.m.input_price) || ('output' in c && c.output !== o.m.output_price);
      })
      .map(o => it(o, 'cost.input=' + (o.m.cost || {}).input + ' / input_price=' + o.m.input_price + '；cost.output=' + (o.m.cost || {}).output + ' / output_price=' + o.m.output_price)) },
  { id:'limit_mismatch', title:'limit 与顶层限制不一致', desc:'limit.context/output 应等于 context_window/max_output_tokens',
    fn: models => models
      .filter(o => {
        const l = o.m.limit || {};
        return ('context' in l && l.context !== o.m.context_window) || ('output' in l && l.output !== o.m.max_output_tokens);
      })
      .map(o => it(o, 'limit.context=' + (o.m.limit || {}).context + ' / context_window=' + o.m.context_window + '；limit.output=' + (o.m.limit || {}).output + ' / max_output_tokens=' + o.m.max_output_tokens)) },
  { id:'category_modality', title:'类别与输出模态不符', desc:'输出仅 video/image 却不是对应类别',
    fn: models => models
      .filter(o => {
        const out = (o.m.modalities && o.m.modalities.output) || [];
        if (out.length === 1 && out[0] === 'video' && o.m.category !== 'video') return true;
        if (out.length === 1 && out[0] === 'image' && o.m.category !== 'image') return true;
        return false;
      })
      .map(o => it(o, 'category=' + o.m.category + '，output=' + JSON.stringify((o.m.modalities || {}).output))) },
  { id:'alias_is_key', title:'别名等于其他模型的 model_key', desc:'该别名永远不会生效',
    fn: (models, ctx) => {
      const r = [];
      for (const o of models)
        for (const a of o.m.aliases || [])
          if (a !== o.key && ctx.keySet.has(a)) r.push(it(o, '别名 ' + a + ' 是其他模型的 model_key'));
      return r;
    } },
  { id:'alias_dup', title:'同一别名属于多个模型', desc:'同一别名只能属于一个模型',
    fn: (models, ctx) => {
      const r = [];
      for (const [a, os] of Object.entries(ctx.owners))
        if (os.length > 1) r.push(it(os[0], '别名 ' + a + ' 同时属于：' + os.map(x => x.brand + '/' + x.key).join('、')));
      return r;
    } }
];

function runChecks(catalog, includeArchived){
  const all = flatten(catalog);
  const models = all.filter(o => includeArchived || o.m.status === 'active');
  const keySet = new Set(all.map(o => o.key));
  const owners = {};
  for (const o of all)
    for (const a of o.m.aliases || []) (owners[a] = owners[a] || []).push(o);
  const ctx = { all, keySet, owners };
  return CHECK_RULES.map(r => ({ id: r.id, title: r.title, desc: r.desc, items: r.fn(models, ctx) }));
}

/* ===================== 图标（内联 SVG，线性 1.5px） ===================== */

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-4a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.82 0L6 21"/>',
  audio: '<path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v10a2 2 0 0 0 4 0v-4a2 2 0 0 1 4 0v-2a2 2 0 0 1 4 0"/>',
  video: '<path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/>'
};
function icon(n, s){
  return '<svg width="' + (s || 16) + '" height="' + (s || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + '</svg>';
}

/* ===================== 浏览器 UI ===================== */

const state = {
  view: 'all', status: 'active', cat: 'all',
  eps: new Set(), caps: new Set(), inMods: new Set(), outMods: new Set(), variants: false,
  q: '', sort: { key: null, dir: 1 }, m: null, arch: false, rule: null
};
const SET_MAP = { ep: 'eps', cap: 'caps', in: 'inMods', out: 'outMods' };
let CATALOG = null, MODELS = [], CATS = [], EPS = [], INMODS = [], OUTMODS = [];
let CHK = {}, currentKey = '', currentJSON = '';
let sbNavEl, sbCheckCntEl, toolbarEl, searchEl, fCatEl, fCountEl, btnFilterEl, phTitleEl, phSubEl, chipsEl,
    tableCardEl, viewModelsEl, viewCheckEl, checkBodyEl, scrimEl, panelEl, popEl;
let popOpen = false;
const mqNarrow = typeof matchMedia !== 'undefined' ? matchMedia('(max-width:1023px)') : null;
const isNarrow = () => mqNarrow && mqNarrow.matches;

function checkCache(arch){
  if (!CHK[arch]) CHK[arch] = runChecks(CATALOG, arch);
  return CHK[arch];
}
function hl(s){
  s = String(s == null ? '' : s);
  const e = esc(s);
  if (!state.q) return e;
  const q = esc(state.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try { return e.replace(new RegExp(q, 'gi'), m => '<mark>' + m + '</mark>'); }
  catch (_) { return e; }
}
function passesNonBrand(o){
  const m = o.m;
  if (state.status !== 'all' && m.status !== state.status) return false;
  if (state.cat !== 'all' && m.category !== state.cat) return false;
  if (state.eps.size) {
    const eps = m.supported_endpoint_types || [];
    for (const e of state.eps) if (!eps.includes(e)) return false;
  }
  if (state.caps.size) {
    const cap = m.capabilities || {};
    for (const c of state.caps) if (cap[c] !== true) return false;
  }
  if (state.inMods.size) {
    const arr = (m.modalities && m.modalities.input) || [];
    for (const x of state.inMods) if (!arr.includes(x)) return false;
  }
  if (state.outMods.size) {
    const arr = (m.modalities && m.modalities.output) || [];
    for (const x of state.outMods) if (!arr.includes(x)) return false;
  }
  if (state.variants && !(m.pricing_variants && Object.keys(m.pricing_variants).length)) return false;
  if (state.q) {
    const q = state.q.toLowerCase();
    const hay = [m.display_name, o.key, (m.aliases || []).join(' '), m.description || ''].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
function filteredList(){
  return MODELS.filter(o => (state.view === 'all' || o.brand === state.view) && passesNonBrand(o));
}
function sortVal(o, k){
  const m = o.m;
  if (k === 'name') return m.display_name || '';
  if (k === 'endpoints') return (m.supported_endpoint_types || []).join(',');
  if (k === 'caps') return CAPS.map(([c]) => m.capabilities && m.capabilities[c] ? '1' : '0').join('');
  if (k === 'cache_read') return cacheAbs(m, m.cache_read_ratio);
  if (k === 'cache_write') return cacheAbs(m, m.cache_write_ratio);
  return m[k];
}
const EFF = new Map();
function effDate(o){
  if (EFF.has(o)) return EFF.get(o);
  let d = o.m.release_date || '';
  if (!d) {
    let best = 0;
    for (const p of MODELS) {
      if (p.brand !== o.brand || !p.m.release_date || p.key.length <= best) continue;
      if (o.key.startsWith(p.key) && '-.'.includes(o.key[p.key.length])) { best = p.key.length; d = p.m.release_date; }
    }
  }
  EFF.set(o, d);
  return d;
}
function verOf(k){
  const t = k.replace(/\d{4}-?\d{2}-?\d{2}|-\d{4}$/g, '');
  const m = t.match(/(\d+(?:[.-]\d+)*)(?![\db])/);
  return m ? m[1].split(/[.-]/).map(Number) : [];
}
function sortModels(list){
  const { key, dir } = state.sort;
  if (!key) {
    list.sort((a, b) => {
      const da = effDate(a), db = effDate(b);
      if (da !== db) return !da ? 1 : !db ? -1 : da < db ? 1 : -1;
      if (!da) {
        const va = verOf(a.key), vb = verOf(b.key);
        for (let i = 0; i < Math.max(va.length, vb.length); i++) {
          const x = va[i] ?? -1, y = vb[i] ?? -1;
          if (x !== y) return y - x;
        }
      }
      return a.key.length - b.key.length || (a.key < b.key ? -1 : 1);
    });
    return list;
  }
  const isNull = v => v == null || v === '';
  const nn = list.filter(o => !isNull(sortVal(o, key)));
  const rest = list.filter(o => isNull(sortVal(o, key)));
  nn.sort((a, b) => {
    const va = sortVal(a, key), vb = sortVal(b, key);
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
  });
  return nn.concat(rest);
}
function brandOrder(){
  const counts = {};
  for (const o of MODELS)
    if (state.status === 'all' || o.m.status === state.status) counts[o.brand] = (counts[o.brand] || 0) + 1;
  return Object.keys(CATALOG.brands).sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
}
function activeCount(){
  return state.eps.size + state.caps.size + state.inMods.size + state.outMods.size + (state.variants ? 1 : 0);
}
function hasExtraFilters(){
  return !!(state.q || state.cat !== 'all' || activeCount());
}
function clearFilters(){
  state.cat = 'all';
  for (const k of ['eps','caps','inMods','outMods']) state[k].clear();
  state.variants = false;
  state.q = '';
  searchEl.value = '';
  if (popOpen) popEl.innerHTML = popoverHTML();
  render();
}

/* ---------- 渲染：侧边栏 ---------- */
function renderSidebar(){
  const counts = {};
  let total = 0;
  for (const o of MODELS)
    if (state.status === 'all' || o.m.status === state.status) { counts[o.brand] = (counts[o.brand] || 0) + 1; total++; }
  let h = '<button class="nav-item' + (state.view === 'all' ? ' on' : '') + '" data-v="all"><span>全部</span><span class="nav-cnt">' + total + '</span></button>';
  for (const k of brandOrder())
    h += '<button class="nav-item' + (state.view === k ? ' on' : '') + '" data-v="' + esc(k) + '"><span>' + esc(brandName(k)) + '</span><span class="nav-cnt">' + (counts[k] || 0) + '</span></button>';
  sbNavEl.innerHTML = h;
  const n = checkCache(false).reduce((s, r) => s + r.items.length, 0);
  sbCheckCntEl.textContent = n;
  sbCheckCntEl.classList.toggle('hidden', !n);
}

/* ---------- 渲染：工具栏 ---------- */
function renderToolbar(){
  toolbarEl.classList.toggle('hidden', state.view === 'check');
  toolbarEl.querySelectorAll('#seg-status button').forEach(b => b.classList.toggle('on', b.dataset.v === state.status));
  fCatEl.value = state.cat;
  const n = activeCount();
  fCountEl.textContent = n;
  fCountEl.classList.toggle('hidden', !n);
  btnFilterEl.classList.toggle('on', popOpen);
}

/* ---------- 渲染：页面标题 ---------- */
function renderPagehead(){
  const h = '<button class="chip-brand' + (state.view === 'all' ? ' on' : '') + '" data-v="all">全部</button>' +
    brandOrder().map(k => '<button class="chip-brand' + (state.view === k ? ' on' : '') + '" data-v="' + esc(k) + '">' + esc(brandName(k)) + '</button>').join('') +
    '<button class="chip-brand' + (state.view === 'check' ? ' on' : '') + '" data-v="check">数据检查</button>';
  chipsEl.innerHTML = h;
  if (state.view === 'check') {
    phTitleEl.textContent = '数据检查';
    phSubEl.innerHTML = '<span>只统计在售模型</span>' +
      '<label class="sw-row"><span class="sw"><input type="checkbox" id="arch-sw"' + (state.arch ? ' checked' : '') + '><i></i></span><span>包含已归档</span></label>';
    return;
  }
  phTitleEl.textContent = state.view === 'all' ? '全部模型' : brandName(state.view);
  const list = filteredList();
  const base = MODELS.filter(o => (state.view === 'all' || o.brand === state.view) && (state.status === 'all' || o.m.status === state.status));
  let s = base.length + ' 个模型 · 目录 ' + esc(CATALOG.catalog_version) + ' · 更新于 ' + fmtDateLocal(CATALOG.updated_at);
  if (hasExtraFilters()) s += ' · 已筛选 ' + list.length + ' / ' + base.length + ' <button class="lnk" id="ph-clear">清除</button>';
  if (state.q && state.view !== 'all') s += ' · <button class="lnk" id="ph-global">在全部中搜索</button>';
  phSubEl.innerHTML = s;
}

/* ---------- 渲染：表格 / 列表 ---------- */
function tt(n){ return n != null ? ' title="' + n.toLocaleString('en-US') + '"' : ''; }
function priceHTML(v){ return v === 0 ? '<span class="free">免费</span>' : fmtUSD(v); }
function capsCell(m){
  const cap = m.capabilities;
  if (!cap || !Object.keys(cap).length) return '<span class="caps-na">未标注</span>';
  return CAPS.map(([k, l, ic]) => '<span class="ci' + (cap[k] === true ? '' : ' off') + '" title="' + l + '">' + icon(ic) + '</span>').join('');
}
function nameBadges(m){
  let h = '';
  if (state.cat === 'all' && m.category && m.category !== 'chat') h += '<span class="bdg">' + esc(m.category) + '</span>';
  if (m.status === 'archived') h += '<span class="bdg bdg-gray">已归档</span>';
  return h;
}
function rowHTML(o){
  const m = o.m;
  const cr = cacheAbs(m, m.cache_read_ratio), cw1 = cacheAbs(m, m.cache_write_1h_ratio);
  const vn = m.pricing_variants ? Object.keys(m.pricing_variants).length : 0;
  return '<tr class="row' + (m.status === 'archived' ? ' arch' : '') + '" data-b="' + esc(o.brand) + '" data-k="' + esc(o.key) + '" tabindex="-1">' +
    '<td class="c-name"><div class="r-name"><span class="r-dn">' + hl(m.display_name) + '</span>' + nameBadges(m) + '</div>' +
    '<div class="r-sub"><span class="r-key">' + hl(o.key) + '</span>' + (vn ? '<span class="bdg bdg-variant">' + vn + ' 个价格档</span>' : '') + '</div></td>' +
    '<td class="num"' + tt(m.context_window) + '>' + fmtTokens(m.context_window) + '</td>' +
    '<td class="num"' + tt(m.max_output_tokens) + '>' + fmtTokens(m.max_output_tokens) + '</td>' +
    '<td class="num">' + priceHTML(m.input_price) + '</td>' +
    '<td class="num">' + priceHTML(m.output_price) + '</td>' +
    '<td class="num"' + (m.cache_read_ratio != null ? ' title="比例 ' + esc(fmtNum(m.cache_read_ratio)) + '"' : '') + '>' + priceHTML(cr) + '</td>' +
    '<td class="num"' + (m.cache_write_ratio != null ? ' title="比例 ' + esc(fmtNum(m.cache_write_ratio)) + '"' : '') + '>' + priceHTML(cacheAbs(m, m.cache_write_ratio)) +
      (cw1 != null ? '<span class="cw1" title="1 小时缓存写，比例 ' + esc(fmtNum(m.cache_write_1h_ratio)) + '">1h ' + fmtUSD(cw1) + '</span>' : '') + '</td>' +
    '<td class="c-caps"><span class="caps">' + capsCell(m) + '</span></td></tr>';
}
function listHTML(list){
  if (!list.length) return emptyHTML();
  let h = '<div class="mlist">';
  for (const o of list) {
    const m = o.m;
    const vn = m.pricing_variants ? Object.keys(m.pricing_variants).length : 0;
    h += '<div class="mrow' + (m.status === 'archived' ? ' arch' : '') + '" data-b="' + esc(o.brand) + '" data-k="' + esc(o.key) + '" tabindex="-1">' +
      '<div class="mr-name">' + hl(m.display_name) + nameBadges(m) + '</div>' +
      '<div class="mr-key">' + hl(o.key) + (vn ? '<span class="bdg bdg-variant" style="margin-left:6px">' + vn + ' 个价格档</span>' : '') + '</div>' +
      '<div class="mr-meta">' + fmtTokens(m.context_window) + ' · ' + fmtUSD(m.input_price) + ' / ' + fmtUSD(m.output_price) + '</div>' +
      '<div class="mr-caps">' + capsCell(m) + '</div></div>';
  }
  return h + '</div>';
}
function emptyHTML(){
  return '<div class="empty"><p>没有匹配的模型</p><button class="btn ghost" id="empty-clear">清除筛选</button></div>';
}
function tableHTML(list, grouped){
  if (isNarrow()) return listHTML(list);
  if (!list.length) return emptyHTML();
  const arr = k => state.sort.key === k ? '<span class="arr">' + (state.sort.dir > 0 ? '▲' : '▼') + '</span>' : '';
  const u = '<span class="th-note">$ / 1M</span>';
  let h = '<div class="tscroll"><table><thead><tr class="tr1">' +
    '<th data-sk="name">模型' + arr('name') + '</th>' +
    '<th data-sk="context_window" class="num">上下文' + arr('context_window') + '</th>' +
    '<th data-sk="max_output_tokens" class="num">最大输出' + arr('max_output_tokens') + '</th>' +
    '<th data-sk="input_price" class="num">输入' + arr('input_price') + u + '</th>' +
    '<th data-sk="output_price" class="num">输出' + arr('output_price') + u + '</th>' +
    '<th data-sk="cache_read" class="num">缓存读' + arr('cache_read') + u + '</th>' +
    '<th data-sk="cache_write" class="num">缓存写' + arr('cache_write') + u + '</th>' +
    '<th data-sk="caps">能力' + arr('caps') + '</th></tr></thead><tbody>';
  if (grouped) {
    const groups = new Map();
    for (const bk of brandOrder()) groups.set(bk, []);
    for (const o of list) if (groups.has(o.brand)) groups.get(o.brand).push(o);
    for (const [bk, a] of groups) {
      if (!a.length) continue;
      h += '<tr class="grp"><td colspan="8"><span class="grp-name">' + esc(brandName(bk)) + '</span><span class="grp-cnt">' + a.length + '</span></td></tr>';
      for (const o of a) h += rowHTML(o);
    }
  } else {
    for (const o of list) h += rowHTML(o);
  }
  return h + '</tbody></table></div>';
}
function renderModels(){
  tableCardEl.innerHTML = tableHTML(sortModels(filteredList()), state.view === 'all');
}

/* ---------- 渲染：数据检查页 ---------- */
function renderCheck(){
  const rules = checkCache(state.arch);
  const sorted = [...rules].sort((a, b) => (a.items.length === 0) - (b.items.length === 0) || b.items.length - a.items.length);
  if (!state.rule || !rules.some(r => r.id === state.rule))
    state.rule = [...rules].sort((a, b) => b.items.length - a.items.length)[0].id;
  let h = '<div class="rule-grid">';
  for (const r of sorted) {
    const n = r.items.length;
    h += '<button class="rulecard mat-thick' + (r.id === state.rule ? ' on' : '') + '" data-rule="' + r.id + '">' +
      '<span class="rc-name">' + esc(r.title) + '</span><span class="rc-desc">' + esc(r.desc) + '</span>' +
      '<span class="rc-count' + (n ? ' warn' : ' ok') + '">' + n + (n ? '' : '<span class="rc-pass">通过</span>') + '</span></button>';
  }
  h += '</div>';
  const cur = rules.find(r => r.id === state.rule);
  const seen = new Set(), list = [];
  if (cur) for (const x of cur.items) {
    const id = x.brand + '/' + x.key;
    if (!seen.has(id)) { seen.add(id); const o = MODELS.find(m => m.brand === x.brand && m.key === x.key); if (o) list.push(o); }
  }
  h += '<div class="rd-head"><span class="rd-title">' + esc(cur ? cur.title : '') + '</span><span class="rd-cnt mono">' + list.length + ' 个模型</span></div>' +
    '<div class="tcard mat-thick">' + tableHTML(sortModels(list), false) + '</div>';
  checkBodyEl.innerHTML = h;
}

/* ---------- 渲染：筛选 Popover ---------- */
function popoverHTML(){
  const chip = (g, v, label, title) =>
    '<button class="chip' + (g === 'cat' ? (state.cat === v ? ' on' : '') : (state[SET_MAP[g]].has(v) ? ' on' : '')) +
    '" data-g="' + g + '" data-v="' + esc(v) + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(label) + '</button>';
  const grp = (t, inner) => '<div class="pop-grp"><p class="pop-t">' + t + '</p><div class="pop-opts">' + inner + '</div></div>';
  let h = '';
  if (isNarrow()) h += grp('类别', '<button class="chip' + (state.cat === 'all' ? ' on' : '') + '" data-g="cat" data-v="all">全部</button>' + CATS.map(c => chip('cat', c, c)).join(''));
  h += grp('协议', EPS.map(e => chip('ep', e, epLabel(e), e)).join(''));
  h += grp('能力（全部满足）', CAPS.map(([k, l]) => chip('cap', k, l)).join(''));
  h += grp('输入模态', INMODS.map(x => chip('in', x, x)).join(''));
  h += grp('输出模态', OUTMODS.map(x => chip('out', x, x)).join(''));
  h += '<label class="sw-row" style="margin:2px 0 10px 4px"><span class="sw"><input type="checkbox" id="pv-sw"' + (state.variants ? ' checked' : '') + '><i></i></span><span>仅显示有价格变体</span></label>';
  h += '<div class="pop-foot"><span class="pop-cnt mono">' + activeCount() + ' 个条件</span><button class="btn ghost" id="pop-clear">清空</button></div>';
  return h;
}
function togglePopover(force){
  const open = force !== undefined ? force : !popOpen;
  if (open === popOpen) return;
  popOpen = open;
  if (open) {
    popEl.innerHTML = popoverHTML();
    popEl.classList.add('open');
    if (!isNarrow()) {
      const r = btnFilterEl.getBoundingClientRect();
      popEl.style.top = (r.bottom + 8) + 'px';
      popEl.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    } else { popEl.style.top = popEl.style.right = ''; }
  } else {
    popEl.classList.remove('open');
  }
  btnFilterEl.classList.toggle('on', popOpen);
  if (isNarrow() && !state.m) document.documentElement.classList.toggle('locked', popOpen);
}
function clearPopover(){
  for (const k of ['eps','caps','inMods','outMods']) state[k].clear();
  state.variants = false;
  if (state.cat !== 'all' && isNarrow()) state.cat = 'all';
  popEl.innerHTML = popoverHTML();
  render();
}

/* ---------- 渲染：详情面板 ---------- */
function sec(t, inner){ return '<section class="p-sec"><h3>' + t + '</h3>' + inner + '</section>'; }
function tokHTML(n){ return n == null ? '—' : '<span class="mono" title="' + n.toLocaleString('en-US') + '">' + fmtTokens(n) + '</span>'; }
function panelHTML(o){
  const m = o.m;
  const hits = checkCache(false).filter(r => r.items.some(x => x.brand === o.brand && x.key === o.key)).map(r => r.title);
  let h = '<div class="p-head"><button class="ibtn p-close" id="p-close" aria-label="关闭">' + icon('close', 18) + '</button>' +
    '<h2 class="p-name">' + esc(m.display_name) + '</h2>' +
    '<div class="p-keyrow"><span class="p-key">' + hl(o.key) + '</span>' +
    '<button class="ibtn" id="p-copy-key" aria-label="复制 model_key">' + icon('copy', 14) + '</button></div>' +
    '<div class="p-badges"><span class="bdg">' + esc(brandName(o.brand)) + '</span>' +
    (m.category ? '<span class="bdg">' + esc(m.category) + '</span>' : '') +
    '<span class="bdg ' + (m.status === 'archived' ? 'bdg-gray' : 'bdg-ok') + '">' + (m.status === 'archived' ? '已归档' : '在售') + '</span></div></div>';
  if (hits.length) h += '<div class="p-alert"><span class="ic">' + icon('warn', 14) + '</span><span>' + hits.map(esc).join('；') + '</span></div>';
  const cw = cacheAbs(m, m.cache_write_ratio), cw1 = cacheAbs(m, m.cache_write_1h_ratio);
  const feet = [];
  if (cw != null) feet.push('写 ' + fmtUSD(cw));
  if (cw1 != null) feet.push('1h 写 ' + fmtUSD(cw1));
  const kpi = (v, l, f) => '<div class="kpi"><span class="kpi-v">' + priceHTML(v) + '</span><span class="kpi-l">' + l + '</span>' + (f || '') + '</div>';
  h += '<div class="kpis">' +
    kpi(m.input_price, '输入 · USD / 1M') + kpi(m.output_price, '输出 · USD / 1M') +
    kpi(cacheAbs(m, m.cache_read_ratio), '缓存读 · USD / 1M',
      (m.cache_read_ratio != null ? '<span class="kpi-foot">×' + fmtNum(m.cache_read_ratio) + '</span>' : '') +
      (feet.length ? '<span class="kpi-foot">' + feet.join(' · ') + '</span>' : '')) + '</div>';
  const pv = m.pricing_variants || {};
  const vkeys = Object.keys(pv);
  if (vkeys.length) {
    h += sec('价格档位', '<table class="vt"><thead><tr><th>档位</th><th class="num">输入</th><th class="num">输出</th><th class="num">缓存读</th></tr></thead><tbody>' +
      vkeys.map(k => {
        const v = pv[k] || {};
        const okeys = VARIANT_OTHER.filter(f => v[f] !== undefined).filter(f => !VARIANT_PRICE.includes(f));
        const others = okeys.map(f => esc((VARIANT_FIELD_LABEL[f] || f) + ' ' + variantVal(f, v[f])));
        return '<tr' + (others.length ? ' class="has-sub"' : '') + '><td class="vt-name">' + esc(variantLabel(k)) + '<span class="vt-key">' + esc(k) + '</span></td>' +
          '<td class="num">' + priceHTML(v.input_price) + '</td><td class="num">' + priceHTML(v.output_price) + '</td>' +
          '<td class="num">' + priceHTML(v.cache_read) + '</td>' +
          '</tr>' + (others.length ? '<tr class="vt-sub"><td colspan="4">' + others.join(' · ') + '</td></tr>' : '');
      }).join('') + '</tbody></table>');
  }
  h += sec('能力', '<div class="pcaps">' + CAPS.map(([k, l, ic]) => {
    const v = m.capabilities ? m.capabilities[k] : undefined;
    const txt = v === true ? '支持' : v === false ? '不支持' : '未标注';
    return '<div class="pcap' + (v === true ? '' : ' na') + '"><span class="ic">' + icon(ic) + '</span><span>' + l + '</span><span class="pcap-s">' + txt + '</span></div>';
  }).join('') + '</div>');
  const eps = (m.supported_endpoint_types || []).map(e => '<span class="bdg" title="' + esc(e) + '">' + esc(epLabel(e)) + '</span>').join(' ');
  const mods = w => { const a = (m.modalities && m.modalities[w]) || []; return a.length ? esc(a.join('、')) : '—'; };
  h += sec('接口与限制', '<dl class="pdl">' +
    '<dt>协议</dt><dd>' + (eps || '—') + '</dd>' +
    '<dt>上下文</dt><dd>' + tokHTML(m.context_window) + '</dd>' +
    '<dt>最大输出</dt><dd>' + tokHTML(m.max_output_tokens) + '</dd>' +
    '<dt>输入模态</dt><dd>' + mods('input') + '</dd>' +
    '<dt>输出模态</dt><dd>' + mods('output') + '</dd></dl>');
  const rows = [];
  if (m.release_date) rows.push(['发布日期', esc(m.release_date)]);
  if (m.knowledge != null) rows.push(['知识截止', esc(String(m.knowledge))]);
  if (m.family) rows.push(['family', '<span class="mono">' + esc(m.family) + '</span>']);
  if (m.aliases && m.aliases.length) rows.push(['别名', '<div class="p-aliases">' + m.aliases.map(a => '<span class="bdg mono">' + esc(a) + '</span>').join('') + '</div>']);
  if (m.description || rows.length)
    h += sec('信息', (m.description ? '<p class="p-desc">' + hl(m.description) + '</p>' : '') +
      '<dl class="pdl">' + rows.map(r => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>');
  h += sec('原始 JSON', '<div class="p-json"><button class="ibtn" id="p-copy-json" aria-label="复制 JSON" title="复制 JSON">' + icon('copy', 14) + '</button>' +
    '<pre>' + esc(JSON.stringify(m, null, 2)) + '</pre></div>');
  return h;
}
function updateRowSel(){
  document.querySelectorAll('.row.sel,.mrow.sel').forEach(el => el.classList.remove('sel'));
  if (!state.m) return;
  document.querySelectorAll('#table-card [data-b][data-k],#check-body [data-b][data-k]').forEach(el => {
    if (el.dataset.b === state.m.brand && el.dataset.k === state.m.key) el.classList.add('sel');
  });
}
function openPanel(b, k){
  const o = MODELS.find(x => x.brand === b && x.key === k);
  if (!o) return;
  togglePopover(false);
  state.m = { brand: b, key: k };
  currentKey = o.key;
  currentJSON = JSON.stringify(o.m, null, 2);
  panelEl.innerHTML = panelHTML(o);
  panelEl.scrollTop = 0;
  panelEl.setAttribute('aria-hidden', 'false');
  scrimEl.classList.add('show');
  panelEl.classList.add('open');
  document.documentElement.classList.add('locked');
  updateRowSel();
  panelEl.querySelector('#p-close').focus();
  syncURL();
}
function closePanel(){
  if (!state.m) return;
  const row = document.querySelector('.row.sel,.mrow.sel');
  state.m = null;
  scrimEl.classList.remove('show');
  panelEl.classList.remove('open');
  document.documentElement.classList.remove('locked');
  panelEl.setAttribute('aria-hidden', 'true');
  updateRowSel();
  if (row && row.isConnected) row.focus();
  syncURL();
}
function copyText(text, btn){
  const orig = btn.innerHTML;
  const show = () => {
    btn.innerHTML = icon('check', 14);
    setTimeout(() => { btn.innerHTML = orig; }, 1200);
  };
  const fb = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); show(); } catch (_) {}
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(show).catch(fb);
  else fb();
}

/* ---------- 渲染入口 / URL ---------- */
function render(){
  renderSidebar();
  renderToolbar();
  renderPagehead();
  viewModelsEl.classList.toggle('hidden', state.view === 'check');
  viewCheckEl.classList.toggle('hidden', state.view !== 'check');
  if (state.view === 'check') renderCheck();
  else renderModels();
  syncURL();
}
function syncURL(){
  const p = new URLSearchParams();
  if (state.view !== 'all') p.set('v', state.view);
  if (state.status !== 'active') p.set('s', state.status);
  if (state.cat !== 'all') p.set('c', state.cat);
  if (state.eps.size) p.set('ep', [...state.eps].join(','));
  if (state.caps.size) p.set('cap', [...state.caps].join(','));
  if (state.inMods.size) p.set('in', [...state.inMods].join(','));
  if (state.outMods.size) p.set('out', [...state.outMods].join(','));
  if (state.variants) p.set('pv', '1');
  if (state.q) p.set('q', state.q);
  if (state.sort.key) p.set('sort', state.sort.key + ':' + (state.sort.dir > 0 ? 'asc' : 'desc'));
  if (state.m) p.set('m', state.m.brand + '/' + state.m.key);
  if (state.arch) p.set('arch', '1');
  if (state.rule && state.view === 'check') p.set('rule', state.rule);
  const qs = p.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
}
function restoreFromURL(){
  const p = new URLSearchParams(location.search);
  const v = p.get('v');
  if (v === 'check' || (v && CATALOG.brands[v])) state.view = v;
  const s = p.get('s');
  if (s === 'active' || s === 'archived' || s === 'all') state.status = s;
  const c = p.get('c');
  if (c && CATS.includes(c)) state.cat = c;
  const ld = (param, valid) => {
    const x = p.get(param);
    return x ? new Set(x.split(',').filter(i => valid.includes(i))) : new Set();
  };
  state.eps = ld('ep', EPS);
  state.caps = ld('cap', CAPS.map(x => x[0]));
  state.inMods = ld('in', INMODS);
  state.outMods = ld('out', OUTMODS);
  state.variants = p.get('pv') === '1';
  state.q = p.get('q') || '';
  const so = p.get('sort');
  if (so) {
    const [k, d] = so.split(':');
    if (SK_KEYS.includes(k)) { state.sort.key = k; state.sort.dir = d === 'desc' ? -1 : 1; }
  }
  state.arch = p.get('arch') === '1';
  state.rule = p.get('rule');
  const m = p.get('m');
  if (m) {
    const i = m.indexOf('/');
    if (i > 0) return { brand: m.slice(0, i), key: m.slice(i + 1) };
  }
  return null;
}
function toggleSort(k){
  if (state.sort.key === k) state.sort.dir *= -1;
  else { state.sort.key = k; state.sort.dir = 1; }
  render();
}

/* ---------- 事件与初始化 ---------- */
function initApp(){
  sbNavEl = document.getElementById('sb-nav');
  sbCheckCntEl = document.getElementById('sb-check-cnt');
  toolbarEl = document.getElementById('toolbar');
  searchEl = document.getElementById('search');
  fCatEl = document.getElementById('f-cat');
  fCountEl = document.getElementById('f-count');
  btnFilterEl = document.getElementById('btn-filter');
  phTitleEl = document.getElementById('ph-title');
  phSubEl = document.getElementById('ph-sub');
  chipsEl = document.getElementById('brand-chips');
  tableCardEl = document.getElementById('table-card');
  viewModelsEl = document.getElementById('view-models');
  viewCheckEl = document.getElementById('view-check');
  checkBodyEl = document.getElementById('check-body');
  scrimEl = document.getElementById('scrim');
  panelEl = document.getElementById('panel');
  popEl = document.getElementById('popover');

  document.querySelectorAll('[data-ic]').forEach(el => {
    el.innerHTML = icon(el.dataset.ic, el.dataset.s ? +el.dataset.s : 16);
  });

  searchEl.addEventListener('input', e => { state.q = e.target.value.trim(); render(); });
  scrimEl.addEventListener('click', closePanel);
  if (mqNarrow && mqNarrow.addEventListener) mqNarrow.addEventListener('change', () => { togglePopover(false); render(); });

  document.addEventListener('mousedown', e => {
    if (popOpen && !popEl.contains(e.target) && !btnFilterEl.contains(e.target)) togglePopover(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (popOpen) togglePopover(false); else closePanel(); return; }
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '');
    if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      searchEl.focus();
      searchEl.select();
    }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'f-cat') { state.cat = e.target.value; render(); return; }
    if (e.target.id === 'pv-sw') { state.variants = e.target.checked; render(); return; }
    if (e.target.id === 'arch-sw') { state.arch = e.target.checked; renderCheck(); syncURL(); return; }
  });
  document.addEventListener('click', e => {
    const seg = e.target.closest('#seg-status button');
    if (seg) { state.status = seg.dataset.v; render(); return; }
    if (e.target.closest('#btn-filter')) { togglePopover(); return; }
    if (e.target.closest('#search-clear')) { state.q = ''; searchEl.value = ''; render(); searchEl.focus(); return; }
    if (e.target.closest('#pop-clear')) { clearPopover(); return; }
    if (e.target.closest('#ph-clear') || e.target.closest('#empty-clear')) { clearFilters(); return; }
    if (e.target.closest('#ph-global')) { state.view = 'all'; render(); return; }
    if (e.target.closest('#p-close')) { closePanel(); return; }
    const ck = e.target.closest('#p-copy-key');
    if (ck) { copyText(currentKey, ck); return; }
    const cj = e.target.closest('#p-copy-json');
    if (cj) { e.preventDefault(); copyText(currentJSON, cj); return; }
    const chip = e.target.closest('.chip[data-g]');
    if (chip) {
      const g = chip.dataset.g, v = chip.dataset.v;
      if (g === 'cat') state.cat = state.cat === v ? 'all' : v;
      else { const s = state[SET_MAP[g]]; s.has(v) ? s.delete(v) : s.add(v); }
      popEl.innerHTML = popoverHTML();
      render();
      return;
    }
    const nav = e.target.closest('.nav-item[data-v]');
    if (nav) { state.view = nav.dataset.v; render(); return; }
    const cb = e.target.closest('.chip-brand[data-v]');
    if (cb) { state.view = cb.dataset.v; render(); return; }
    const rc = e.target.closest('.rulecard[data-rule]');
    if (rc) { state.rule = rc.dataset.rule; renderCheck(); syncURL(); return; }
    const th = e.target.closest('th[data-sk]');
    if (th) { toggleSort(th.dataset.sk); return; }
    const row = e.target.closest('[data-b][data-k]');
    if (row) { openPanel(row.dataset.b, row.dataset.k); return; }
  });

  fetch('catalog.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(c => {
      CATALOG = c;
      MODELS = flatten(c);
      CATS = [...new Set(MODELS.map(o => o.m.category).filter(Boolean))].sort();
      EPS = [...new Set(MODELS.flatMap(o => o.m.supported_endpoint_types || []))].sort();
      INMODS = [...new Set(MODELS.flatMap(o => (o.m.modalities && o.m.modalities.input) || []))].sort();
      OUTMODS = [...new Set(MODELS.flatMap(o => (o.m.modalities && o.m.modalities.output) || []))].sort();
      fCatEl.innerHTML = '<option value="all">全部类别</option>' + CATS.map(x => '<option value="' + esc(x) + '">' + esc(x) + '</option>').join('');
      const pending = restoreFromURL();
      searchEl.value = state.q;
      render();
      if (pending) { state.m = null; openPanel(pending.brand, pending.key); }
    })
    .catch(e => {
      tableCardEl.innerHTML = '<div class="empty"><p>加载 catalog.json 失败：' + esc(e.message) + '</p></div>';
    });
}

if (typeof document !== 'undefined' && document.getElementById('toolbar')) initApp();
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runChecks, flatten, fmtTokens, fmtUSD, fmtNum, cacheAbs, variantLabel, variantVal, CHECK_RULES };
}
