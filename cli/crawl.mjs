#!/usr/bin/env node
// screenshot-docs URL 모드: URL 하나로 화면 설계서(design-doc.html + screenshots/*.png + screens.json)를 만든다.
// 탐색은 <a href> 이동(page.goto)만 한다. 클릭·입력·폼 제출은 하지 않는다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { renderDesignDoc } from '../web/render.js';

const HELP = `사용법:
  node cli/crawl.mjs --url <시작 URL> [옵션]

옵션:
  --scope domain|prefix   탐색 범위 (기본 prefix)
  --prefix <경로>         scope=prefix일 때 경로 prefix (기본: 시작 URL의 경로)
  --max-pages <n>         최대 페이지 수 (기본 30)
  --max-depth <n>         최대 깊이 (기본 3, 시작 페이지=0)
  --viewport <WxH>        뷰포트 (기본 1440x900)
  --storage-state <파일>  로그인 영역 접근용 Playwright storageState.json
  --urls <파일>           추가로 수집할 URL 목록(한 줄에 하나). JS 라우팅 사이트 보조 입력
  --sitemap               <origin>/sitemap.xml 의 URL도 보조 입력으로 사용
  --timeout <ms>          페이지당 타임아웃 (기본 30000)
  --out <폴더>            출력 폴더 (기본 ./output)
  --name <이름>           표지에 쓸 사이트명 (기본: 첫 페이지 제목)`;

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[key] = true;
    else { a[key] = next; i++; }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args.url || args.help) { console.log(HELP); process.exit(args.url ? 0 : 1); }

const startUrl = normalize(args.url);
if (!startUrl) { console.error('잘못된 URL:', args.url); process.exit(1); }
const start = new URL(startUrl);
const scope = args.scope === 'domain' ? 'domain' : 'prefix';
// prefix=/event/jongno 이면 /event/jongno 와 그 하위(/event/jongno/...)가 범위다
const prefix = args.prefix || start.pathname;
const maxPages = parseInt(args['max-pages'] ?? '30', 10);
const maxDepth = parseInt(args['max-depth'] ?? '3', 10);
const [vw, vh] = String(args.viewport || '1440x900').split('x').map((n) => parseInt(n, 10));
const timeout = parseInt(args.timeout ?? '30000', 10);
const outDir = path.resolve(args.out || 'output');
const shotDir = path.join(outDir, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
const logPath = path.join(outDir, 'run.log');
fs.writeFileSync(logPath, '');
const log = (action, detail) => {
  const line = `${new Date().toISOString()} ${action} ${detail}`;
  fs.appendFileSync(logPath, line + '\n');
  console.log(line);
};

function normalize(href, base) {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch { return null; }
}

function inScope(url) {
  const u = new URL(url);
  if (scope === 'domain') return u.hostname === start.hostname;
  if (u.origin !== start.origin) return false;
  const p = prefix.endsWith('/') && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
  return p === '/' || u.pathname === p || u.pathname.startsWith(p + '/');
}

const LOGIN_RE = /(^|\/)(login|signin|sign-in|auth|account\/login)(\/|$)/i;

// 브라우저 안에서 실행: 화면 구조 추출
function extractDom() {
  const visible = (el) => {
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') return false;
    return el.getClientRects().length > 0;
  };
  const text = (el) =>
    (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') ||
      el.querySelector?.('img[alt]')?.getAttribute('alt') || el.value || '')
      .replace(/\s+/g, ' ').trim().slice(0, 80);
  const region = (el) => {
    if (el.closest('header,[role=banner]')) return '헤더';
    if (el.closest('nav,[role=navigation]')) return '내비게이션';
    if (el.closest('footer,[role=contentinfo]')) return '푸터';
    return '본문';
  };
  const labelOf = (f) => {
    let l = '';
    if (f.labels && f.labels[0]) {
      // 라벨 안에 들어 있는 입력 요소(select 선택지 등)의 글자는 빼고 라벨 문구만 쓴다
      const c = f.labels[0].cloneNode(true);
      c.querySelectorAll('input,select,textarea,option,button').forEach((x) => x.remove());
      l = c.textContent;
    }
    return (l || f.getAttribute('aria-label') || f.getAttribute('placeholder') || f.name || f.id || f.type || '')
      .replace(/\s+/g, ' ').trim().slice(0, 60);
  };

  const landmarks = [];
  for (const [sel, name] of [['header,[role=banner]', '헤더'], ['nav,[role=navigation]', '내비게이션'], ['main,[role=main]', '본문 영역'], ['footer,[role=contentinfo]', '푸터']]) {
    const el = document.querySelector(sel);
    if (el && visible(el)) landmarks.push({ name, links: el.querySelectorAll('a[href]').length, buttons: el.querySelectorAll('button').length });
  }

  const headings = [...document.querySelectorAll('h1,h2')].filter(visible)
    .map((h) => ({ level: h.tagName.toLowerCase(), text: text(h) })).filter((h) => h.text).slice(0, 20);

  const seen = new Set();
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    if (!visible(a)) continue;
    const href = a.href;
    const t = text(a);
    const key = t + '|' + href;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ text: t || href, href, region: region(a) });
  }

  const buttons = [];
  for (const b of document.querySelectorAll('button,[role=button],input[type=submit],input[type=button],input[type=reset]')) {
    if (!visible(b) || b.closest('a[href]')) continue;
    buttons.push({
      text: text(b) || '(텍스트 없음)',
      kind: (b.getAttribute('type') || (b.tagName === 'BUTTON' && b.form ? 'submit' : 'button')).toLowerCase(),
      inForm: !!(b.form || b.closest('form')),
      region: region(b),
    });
  }

  const forms = [];
  const fieldSel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),select,textarea';
  const formEls = [...document.querySelectorAll('form')].filter(visible);
  for (const f of formEls) {
    forms.push({
      action: f.getAttribute('action') || '',
      method: (f.getAttribute('method') || 'get').toUpperCase(),
      fields: [...f.querySelectorAll(fieldSel)].filter(visible).map((x) => ({
        label: labelOf(x),
        type: x.tagName === 'SELECT' ? 'select' : x.tagName === 'TEXTAREA' ? 'textarea' : (x.type || 'text'),
        required: x.required,
        options: x.tagName === 'SELECT' ? [...x.options].map((o) => o.text.trim()).slice(0, 8) : undefined,
      })),
    });
  }
  // form 태그 없이 놓인 입력 항목
  const loose = [...document.querySelectorAll(fieldSel)].filter((x) => visible(x) && !x.closest('form'));
  if (loose.length) {
    forms.push({ action: '', method: '', loose: true, fields: loose.map((x) => ({
      label: labelOf(x),
      type: x.tagName === 'SELECT' ? 'select' : x.tagName === 'TEXTAREA' ? 'textarea' : (x.type || 'text'),
      required: x.required,
      options: x.tagName === 'SELECT' ? [...x.options].map((o) => o.text.trim()).slice(0, 8) : undefined,
    })) });
  }

  const siteName = document.querySelector('meta[property="og:site_name"]')?.content || '';
  return { title: document.title.trim(), siteName, landmarks, headings, links, buttons, forms,
    hasPassword: !!document.querySelector('input[type=password]') };
}

async function main() {
  const browser = await chromium.launch();
  const ctxOpts = { viewport: { width: vw, height: vh } };
  if (args['storage-state']) {
    if (!fs.existsSync(args['storage-state'])) { console.error('storageState 파일 없음:', args['storage-state']); process.exit(1); }
    ctxOpts.storageState = args['storage-state'];
  }
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);

  const queue = [{ url: startUrl, depth: 0, from: null }];
  const queued = new Set([startUrl]);
  const uncollected = new Map(); // url → {reason, detail}
  const miss = (url, reason, detail = '') => { if (!uncollected.has(url)) uncollected.set(url, { url, reason, detail }); };

  // 보조 입력: URL 목록 / sitemap.xml
  const extras = [];
  if (args.urls) {
    for (const line of fs.readFileSync(args.urls, 'utf8').split(/\r?\n/)) {
      const u = normalize(line.trim()); if (u) extras.push(u);
    }
  }
  if (args.sitemap) {
    const smUrl = new URL('/sitemap.xml', start.origin).toString();
    log('FETCH', smUrl);
    try {
      const res = await context.request.get(smUrl, { timeout });
      if (res.ok()) {
        const xml = await res.text();
        for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) { const u = normalize(m[1]); if (u) extras.push(u); }
      }
    } catch (e) { log('FETCH_FAIL', `${smUrl} ${e.message.split('\n')[0]}`); }
  }
  for (const u of extras) {
    if (queued.has(u)) continue;
    if (!inScope(u)) { miss(u, '범위 밖', '보조 입력 URL'); continue; }
    queue.push({ url: u, depth: 1, from: null, extra: true });
    queued.add(u);
  }

  const results = []; // 수집 시도한 페이지
  let n = 0;
  while (queue.length) {
    const item = queue.shift();
    if (results.length >= maxPages) { miss(item.url, '최대 페이지 수 초과', `제한 ${maxPages}`); continue; }
    const id = 'S' + String(++n).padStart(3, '0');
    const rec = { id, url: item.url, path: new URL(item.url).pathname + new URL(item.url).search, depth: item.depth,
      fromUrl: item.from, status: 'ok' };
    log('GOTO', item.url);
    let resp;
    try {
      resp = await page.goto(item.url, { waitUntil: 'load', timeout });
      await page.waitForLoadState('networkidle', { timeout: Math.min(8000, timeout) }).catch(() => {});
      // 클라이언트 렌더링 대기: "불러오는 중" 같은 로딩 문구가 사라질 때까지 최대 5초
      await page.waitForFunction(() => !/불러오는 중|loading\.\.\./i.test(document.body?.innerText || ''), null, { timeout: 5000 }).catch(() => {});
    } catch (e) {
      const isTimeout = /timeout/i.test(e.message);
      rec.status = 'failed';
      miss(item.url, isTimeout ? '타임아웃' : '오류', e.message.split('\n')[0].slice(0, 160));
      results.push(rec); n--; continue;
    }
    const status = resp ? resp.status() : 0;
    const finalUrl = normalize(page.url());
    if (status === 401 || status === 403) {
      rec.status = 'failed'; miss(item.url, '로그인 필요', `HTTP ${status}`); results.push(rec); n--; continue;
    }
    if (status >= 400) {
      rec.status = 'failed'; miss(item.url, '오류', `HTTP ${status}`); results.push(rec); n--; continue;
    }
    if (finalUrl && finalUrl !== item.url && LOGIN_RE.test(new URL(finalUrl).pathname) && !LOGIN_RE.test(new URL(item.url).pathname)) {
      rec.status = 'failed'; miss(item.url, '로그인 필요', `로그인 화면으로 이동됨: ${finalUrl}`); results.push(rec); n--; continue;
    }
    if (finalUrl && finalUrl !== item.url) {
      rec.redirectedTo = finalUrl;
      if (queued.has(finalUrl) && finalUrl !== item.url) {
        // 이미 큐에 있는(또는 수집한) 화면으로 리다이렉트 → 중복 화면으로 보지 않는다
        rec.status = 'failed'; miss(item.url, '중복', `리다이렉트: ${finalUrl}`); results.push(rec); n--; continue;
      }
      queued.add(finalUrl);
      if (!inScope(finalUrl)) { rec.status = 'failed'; miss(item.url, '범위 밖', `리다이렉트: ${finalUrl}`); results.push(rec); n--; continue; }
    }

    const shotRel = `screenshots/${id}.png`;
    try {
      await page.screenshot({ path: path.join(outDir, shotRel), fullPage: true });
      log('SCREENSHOT', `${id} ${item.url}`);
    } catch (e) {
      rec.status = 'failed'; miss(item.url, '오류', '스크린샷 실패: ' + e.message.split('\n')[0]); results.push(rec); n--; continue;
    }
    rec.screenshot = shotRel;
    rec.aria = await page.locator('body').ariaSnapshot({ timeout: 10000 }).catch(() => '');
    rec.dom = await page.evaluate(extractDom);
    rec.title = rec.dom.title;
    rec.links = rec.dom.links.map((l) => ({ ...l, href: normalize(l.href) || l.href }));
    results.push(rec);

    for (const l of rec.links) {
      const u = normalize(l.href);
      if (!u || queued.has(u)) continue;
      if (!inScope(u)) { miss(u, '범위 밖', `${id}에서 발견`); continue; }
      if (item.depth + 1 > maxDepth) { miss(u, '최대 깊이 초과', `깊이 ${item.depth + 1} > ${maxDepth}`); continue; }
      queued.add(u);
      queue.push({ url: u, depth: item.depth + 1, from: item.url });
    }
  }
  await browser.close();

  // 화면 ID 매핑, 흐름, 기능 설명
  const ok = results.filter((r) => r.status === 'ok');
  const idByUrl = new Map();
  for (const r of ok) { idByUrl.set(r.url, r.id); if (r.redirectedTo) idByUrl.set(r.redirectedTo, r.id); }
  for (const r of ok) {
    r.parentId = r.fromUrl ? idByUrl.get(r.fromUrl) || null : null;
    r.outbound = [...new Set(r.links.map((l) => idByUrl.get(l.href)).filter((x) => x && x !== r.id))];
  }
  for (const r of ok) r.inbound = ok.filter((o) => o.outbound.includes(r.id)).map((o) => o.id);
  for (const r of ok) { r.elements = buildElements(r, idByUrl); r.description = buildDescription(r, idByUrl); }

  const siteName = args.name || ok[0]?.dom.siteName || ok[0]?.title || start.hostname;
  const data = {
    meta: {
      siteName, startUrl, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      viewport: { width: vw, height: vh }, scope, prefix: scope === 'prefix' ? prefix : null,
      scopeLabel: scope === 'domain' ? `도메인 ${start.hostname}` : `경로 prefix ${start.origin}${prefix}`,
      maxPages, maxDepth, storageState: !!args['storage-state'],
    },
    screens: ok.map(({ dom, fromUrl, ...r }) => ({
      ...r, title: r.title, headings: dom.headings, forms: dom.forms,
    })),
    uncollected: [...uncollected.values()],
  };
  fs.writeFileSync(path.join(outDir, 'screens.json'), JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(outDir, 'design-doc.html'), renderDesignDoc(data));
  console.log(`\n완료: 성공 ${ok.length}개, 미수집 ${data.uncollected.length}개 → ${path.join(outDir, 'design-doc.html')}`);
}

function target(href, idByUrl) {
  if (/^mailto:/i.test(href)) return `메일 작성 창 열기 (${href.slice(7).split('?')[0]})`;
  if (/^tel:/i.test(href)) return `전화 걸기 (${href.slice(4)})`;
  const id = idByUrl.get(href);
  if (id) return `${id} 화면으로 이동`;
  try {
    const u = new URL(href);
    if (u.origin !== start.origin) return `외부 사이트 ${u.hostname}${u.pathname === '/' ? '' : u.pathname}로 이동 (새 창 여부 미확인)`;
    return `${u.pathname}${u.search}로 이동 (미수집 화면)`;
  } catch { return `${href}로 이동`; }
}

function buildElements(r, idByUrl) {
  const d = r.dom;
  const els = [];
  for (const lm of d.landmarks) els.push({ name: lm.name, type: '영역', function: `링크 ${lm.links}개, 버튼 ${lm.buttons}개를 담은 ${lm.name}` });
  for (const h of d.headings) els.push({ name: h.text, type: h.level === 'h1' ? '제목(H1)' : '섹션 제목(H2)', function: h.level === 'h1' ? '화면 대표 제목' : '본문 섹션 구분' });
  for (const f of d.forms) {
    const fields = f.fields.map((x) => `${x.label}(${x.type}${x.required ? ', 필수' : ''})`).join(', ');
    els.push({ name: f.loose ? '입력 항목(폼 태그 없음)' : `폼 ${f.method} ${f.action || '(현재 주소)'}`, type: '폼',
      function: `입력 항목 ${f.fields.length}개: ${fields || '없음'}. 탐색 중 제출하지 않음` });
    for (const x of f.fields) els.push({ name: x.label || '(라벨 없음)', type: `입력(${x.type})`,
      function: `${x.label || '값'} 입력${x.required ? ' — 필수' : ''}${x.options ? ` — 선택지: ${x.options.join(' / ')}` : ''}` });
  }
  for (const b of d.buttons) els.push({ name: b.text, type: b.kind === 'submit' ? '버튼(제출)' : '버튼',
    function: b.kind === 'submit' || b.inForm ? '폼 제출/실행 버튼. 상태를 바꿀 수 있어 탐색 중 누르지 않음' : `${b.region}의 동작 버튼. 결과는 클릭이 필요해 미확인` });
  for (const l of r.links) els.push({ name: l.text, type: `링크(${l.region})`, function: target(l.href, idByUrl) });
  return els;
}

function buildDescription(r, idByUrl) {
  const d = r.dom;
  const s = [];
  s.push(`「${r.title || r.path}」 화면이다.`);
  const h1 = d.headings.find((h) => h.level === 'h1');
  if (h1) s.push(`대표 제목은 「${h1.text}」이다.`);
  const h2 = d.headings.filter((h) => h.level === 'h2').map((h) => h.text);
  if (h2.length) s.push(`본문은 ${h2.slice(0, 6).map((t) => `「${t}」`).join(', ')}${h2.length > 6 ? ` 외 ${h2.length - 6}개` : ''} 섹션으로 구성된다.`);
  const nav = r.links.filter((l) => l.region === '헤더' || l.region === '내비게이션');
  if (nav.length) s.push(`상단 메뉴(${nav.map((l) => l.text).slice(0, 6).join(', ')})로 다른 화면에 이동한다.`);
  const internal = r.outbound.length;
  const external = r.links.filter((l) => { try { const u = new URL(l.href); return /^https?:$/.test(u.protocol) && u.origin !== start.origin; } catch { return false; } });
  if (internal) s.push(`수집된 화면 ${internal}개로 이동할 수 있다.`);
  if (external.length) s.push(`외부 링크 ${external.length}개(${[...new Set(external.map((l) => new URL(l.href).hostname))].slice(0, 3).join(', ')})가 있다.`);
  const fieldCount = d.forms.reduce((a, f) => a + f.fields.length, 0);
  if (d.forms.length) s.push(`입력 폼 ${d.forms.length}개(입력 항목 ${fieldCount}개)가 있으며, 제출 동작은 확인하지 않았다.`);
  if (d.hasPassword) s.push('비밀번호 입력란이 있는 로그인/인증 화면이다.');
  if (d.buttons.length) s.push(`버튼 ${d.buttons.length}개(${d.buttons.map((b) => b.text).slice(0, 5).join(', ')})가 있다.`);
  return s.join(' ');
}

main().catch((e) => { console.error(e); process.exit(1); });
