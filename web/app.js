import { renderDesignDoc, esc } from './render.js';

const $ = (id) => document.getElementById(id);

// ---------- 탭 ----------
function showTab(name) {
  for (const t of ['make', 'review']) {
    $('tab-' + t).setAttribute('aria-selected', String(t === name));
    $('panel-' + t).hidden = t !== name;
  }
}
$('tab-make').onclick = () => showTab('make');
$('tab-review').onclick = () => showTab('review');

// ---------- ① 수집 명령 만들기 ----------
const urlIn = $('f-url');
let prefixTouched = false;
$('f-prefix').addEventListener('input', () => { prefixTouched = true; });
urlIn.addEventListener('input', () => {
  if (prefixTouched) return;
  try { $('f-prefix').value = new URL(urlIn.value.trim()).pathname.replace(/\/$/, '') || '/'; } catch {}
});
document.querySelectorAll('input[name=scope]').forEach((r) =>
  r.addEventListener('change', () => { $('prefixField').hidden = scopeVal() !== 'prefix'; }));
const scopeVal = () => document.querySelector('input[name=scope]:checked').value;

function validate() {
  const err = $('err-url');
  let u;
  try { u = new URL(urlIn.value.trim()); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol)) {
    err.textContent = 'http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.';
    err.hidden = false; urlIn.focus(); return null;
  }
  err.hidden = true;
  const pages = Math.max(1, Math.min(500, parseInt($('f-pages').value, 10) || 30));
  const depth = Math.max(0, Math.min(10, parseInt($('f-depth').value, 10) || 0));
  $('f-pages').value = pages; $('f-depth').value = depth;
  let prefix = $('f-prefix').value.trim() || '/';
  if (!prefix.startsWith('/')) prefix = '/' + prefix;
  return { url: u.toString(), scope: scopeVal(), prefix, pages, depth, vp: $('f-vp').value,
    sitemap: $('f-sitemap').checked, state: $('f-state').checked };
}

$('makeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = validate();
  if (!v) return;
  const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
  const parts = ['node cli/crawl.mjs', `--url ${q(v.url)}`, `--scope ${v.scope}`];
  if (v.scope === 'prefix') parts.push(`--prefix ${q(v.prefix)}`);
  parts.push(`--max-pages ${v.pages}`, `--max-depth ${v.depth}`, `--viewport ${v.vp}`);
  if (v.sitemap) parts.push('--sitemap');
  if (v.state) parts.push('--storage-state storageState.json');
  parts.push('--out output');
  $('cmdText').textContent = parts.join(' ');
  $('cmdEmpty').hidden = true; $('cmdOut').hidden = false; $('copyMsg').textContent = '';
});

$('copyBtn').onclick = async () => {
  const text = $('cmdText').textContent;
  try { await navigator.clipboard.writeText(text); $('copyMsg').textContent = '복사했습니다.'; }
  catch {
    const r = document.createRange(); r.selectNodeContents($('cmdText'));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    $('copyMsg').textContent = '자동 복사가 막혀 있어 명령을 선택해 두었습니다. Ctrl+C로 복사하세요.';
  }
};

// ---------- ② 검토 ----------
const S = { data: null, key: '', base: '', images: new Map(), edits: {}, reviewed: {}, cur: 0 };
const okScreens = () => (S.data?.screens || []).filter((s) => s.status === 'ok');

const store = {
  load(key) { try { return JSON.parse(localStorage.getItem('sdoc:' + key) || 'null'); } catch { return null; } },
  save() { try { localStorage.setItem('sdoc:' + S.key, JSON.stringify({ edits: S.edits, reviewed: S.reviewed })); } catch {} },
};

function loadData(data, key, imageMap) {
  if (!data || !Array.isArray(data.screens)) throw new Error('screens.json 형식이 아닙니다 (screens 배열 없음).');
  S.data = data; S.key = key; S.images = imageMap; S.cur = 0;
  const saved = store.load(key) || {};
  S.edits = saved.edits || {}; S.reviewed = saved.reviewed || {};
  $('loadErr').hidden = true;
  $('reviewEmpty').hidden = true; $('reviewArea').hidden = false;
  renderAll();
}

function showLoadErr(msg) { $('loadErr').textContent = msg; $('loadErr').hidden = false; }

async function loadSample(dir, label) {
  try {
    const res = await fetch(`samples/${dir}/screens.json`);
    if (!res.ok) throw new Error(`샘플을 불러오지 못했습니다 (HTTP ${res.status}).`);
    const data = await res.json();
    const m = new Map();
    for (const s of data.screens) if (s.screenshot) m.set(s.screenshot, `samples/${dir}/${s.screenshot}`);
    loadData(data, 'sample-' + dir, m);
  } catch (e) { showLoadErr(e.message); }
}
$('loadTest').onclick = () => loadSample('test-site');
$('loadJongno').onclick = () => loadSample('jongno');

let pendingShots = new Map();
$('upShots').addEventListener('change', (e) => {
  pendingShots = new Map([...e.target.files].map((f) => [f.name, URL.createObjectURL(f)]));
  if (S.data && S.key.startsWith('upload-')) { S.images = shotsFor(S.data); renderAll(); }
});
function shotsFor(data) {
  const m = new Map();
  for (const s of data.screens) if (s.screenshot) {
    const name = s.screenshot.split('/').pop();
    if (pendingShots.has(name)) m.set(s.screenshot, pendingShots.get(name));
  }
  return m;
}
$('upJson').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    loadData(data, 'upload-' + (data.meta?.startUrl || f.name) + '-' + (data.meta?.generatedAt || ''), shotsFor(data));
  } catch (err) { showLoadErr('파일을 읽지 못했습니다: ' + err.message); }
});

const descOf = (s) => (S.edits[s.id] ?? s.description ?? '');

function renderAll() { renderStatus(); renderSide(); renderScreen(); renderMiss(); }

function renderStatus() {
  const m = S.data.meta || {}, list = okScreens();
  const done = list.filter((s) => S.reviewed[s.id]).length;
  $('siteName').textContent = m.siteName || m.startUrl || '사이트';
  $('siteMeta').textContent = `${m.startUrl || ''} · 화면 ${list.length}개 · 미수집 ${(S.data.uncollected || []).length}개 · 생성 ${m.generatedAt || '-'}`;
  $('progBar').style.width = list.length ? `${(done / list.length) * 100}%` : '0';
  $('progText').textContent = `검토 ${done}/${list.length}`;
  const missingShots = list.filter((s) => !S.images.get(s.screenshot)).length;
  const warns = [];
  if (done < list.length) warns.push(`검토 안 된 화면 ${list.length - done}개는 자동 생성 설명 그대로 내보내집니다.`);
  if (missingShots) warns.push(`스크린샷 없는 화면 ${missingShots}개 — 로컬 수집기로 수집하거나 스크린샷 파일을 함께 올리세요.`);
  if (m.note) warns.push(m.note);
  $('exportWarn').textContent = warns.join(' ');
  $('exportWarn').hidden = !warns.length;
}

function renderSide() {
  $('sideList').innerHTML = okScreens().map((s, i) => `<button type="button" data-i="${i}" aria-current="${i === S.cur}">
    <span class="dot ${S.reviewed[s.id] ? 'done' : ''}"></span><span class="sid">${esc(s.id)}</span><span class="t">${esc(s.title || s.path)}</span></button>`).join('');
  $('sideList').querySelectorAll('button').forEach((b) => (b.onclick = () => { S.cur = +b.dataset.i; renderSide(); renderScreen(); }));
}

function renderScreen() {
  const list = okScreens();
  const s = list[S.cur];
  if (!s) { $('screenView').innerHTML = '<div class="empty">수집된 화면이 없습니다.</div>'; return; }
  const src = S.images.get(s.screenshot);
  const byId = new Map(list.map((x) => [x.id, x]));
  const ids = (a) => (a && a.length ? a.map((id) => `${id} ${byId.get(id)?.title || ''}`).join(', ') : '없음');
  const rows = (s.elements || []).map((e) => `<tr><td>${esc(e.name)}</td><td class="ty">${esc(e.type)}</td><td>${esc(e.function)}</td></tr>`).join('');
  const edited = S.edits[s.id] !== undefined && S.edits[s.id] !== s.description;
  $('screenView').innerHTML = `
    <div class="shead"><span class="badge">${esc(s.id)}</span><h3>${esc(s.title || '(제목 없음)')}</h3></div>
    <div class="url">${esc(s.url)}</div>
    ${src ? `<div class="shot"><img src="${esc(src)}" alt="${esc(s.id)} 스크린샷"></div>` : '<div class="shot noshot">스크린샷 없음 — 로컬 수집기로 수집하면 채워집니다.</div>'}
    <div class="flabel">UI 요소 (${(s.elements || []).length}개)</div>
    <div class="tblwrap"><table><thead><tr><th>요소</th><th>유형</th><th>기능</th></tr></thead><tbody>${rows || '<tr><td colspan="3">없음</td></tr>'}</tbody></table></div>
    <div class="flow"><b>진입</b> ${esc(ids(s.inbound))}<br><b>이동</b> ${esc(ids(s.outbound))}</div>
    <div class="review">
      <label class="flabel" for="descEdit">기능 설명 — 자동 생성 초안을 실제 화면 의도에 맞게 고치세요</label>
      <textarea id="descEdit">${esc(descOf(s))}</textarea>
      <div class="bar">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <label class="check done-check"><input type="checkbox" id="reviewChk" ${S.reviewed[s.id] ? 'checked' : ''}> 검토 완료</label>
          <button class="btn" type="button" id="resetDesc" ${edited ? '' : 'hidden'}>자동 생성 설명으로 되돌리기</button>
          <span class="edited" id="editedMark" ${edited ? '' : 'hidden'}>수정됨</span>
        </div>
        <div class="navbtns">
          <button class="btn" type="button" id="prevBtn" ${S.cur === 0 ? 'disabled' : ''}>이전 화면</button>
          <button class="btn" type="button" id="nextBtn" ${S.cur >= list.length - 1 ? 'disabled' : ''}>다음 화면</button>
        </div>
      </div>
    </div>`;
  $('descEdit').addEventListener('input', (e) => {
    S.edits[s.id] = e.target.value; store.save();
    const ed = e.target.value !== s.description;
    $('editedMark').hidden = !ed; $('resetDesc').hidden = !ed;
  });
  $('resetDesc').onclick = () => { delete S.edits[s.id]; store.save(); renderScreen(); };
  $('reviewChk').onchange = (e) => { S.reviewed[s.id] = e.target.checked; store.save(); renderStatus(); renderSide(); };
  $('prevBtn').onclick = () => { S.cur--; renderSide(); renderScreen(); };
  $('nextBtn').onclick = () => { S.cur++; renderSide(); renderScreen(); };
}

function renderMiss() {
  const m = S.data.uncollected || [];
  $('missView').innerHTML = `<h2>미수집 목록 (${m.length})</h2>` + (m.length
    ? `<div class="tblwrap"><table><thead><tr><th>URL</th><th>사유</th><th>상세</th></tr></thead><tbody>${m.map((x) => `<tr><td>${esc(x.url)}</td><td>${esc(x.reason)}</td><td>${esc(x.detail || '')}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="hint">없음</div>');
}

// ---------- 내보내기 ----------
function reviewedData() {
  const d = structuredClone(S.data);
  for (const s of d.screens) {
    if (S.edits[s.id] !== undefined) s.description = S.edits[s.id];
    s.reviewed = !!S.reviewed[s.id];
  }
  return d;
}
async function toDataUrl(src) {
  const blob = await (await fetch(src)).blob();
  return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
}
function saveFile(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = () => (S.data.meta?.siteName || 'site').replace(/[^\w가-힣]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

$('previewBtn').onclick = () => {
  const html = renderDesignDoc(reviewedData(), { imageSrc: (s) => (S.images.get(s.screenshot) ? new URL(S.images.get(s.screenshot), location.href).href : '') });
  const w = window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
  if (!w) showLoadErr('팝업이 막혀 미리보기를 열지 못했습니다. 「설계서 내보내기」로 파일을 받아 여세요.');
};
$('downloadBtn').onclick = async () => {
  const btn = $('downloadBtn'); btn.disabled = true; btn.textContent = '이미지 포함하는 중…';
  try {
    const embedded = new Map();
    for (const s of okScreens()) {
      const src = S.images.get(s.screenshot);
      if (src) embedded.set(s.id, await toDataUrl(src));
    }
    const html = renderDesignDoc(reviewedData(), { imageSrc: (s) => embedded.get(s.id) || '' });
    saveFile(`design-doc-${slug()}.html`, html, 'text/html');
  } catch (e) { showLoadErr('내보내기 실패: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '설계서 내보내기 (HTML)'; }
};
$('jsonBtn').onclick = () => saveFile(`screens-reviewed-${slug()}.json`, JSON.stringify(reviewedData(), null, 2), 'application/json');
