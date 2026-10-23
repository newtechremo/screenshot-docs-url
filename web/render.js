// screens.json → 화면 설계서 HTML. Node(CLI)와 브라우저(웹)에서 같은 코드를 쓴다.

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const DOC_CSS = `
:root{--ink:#16181d;--sub:#5b6170;--line:#dfe2e8;--bg:#fff;--soft:#f5f6f8;--accent:#1f5eff;--warn:#b45309}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 "Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif}
.doc{max-width:1040px;margin:0 auto;padding:40px 24px 80px}
.cover{border-bottom:2px solid var(--ink);padding:24px 0 28px;margin-bottom:32px}
.cover .kicker{font-size:13px;letter-spacing:.08em;color:var(--sub);text-transform:uppercase}
.cover h1{font-size:34px;margin:8px 0 18px;line-height:1.25}
.cover dl{display:grid;grid-template-columns:120px 1fr;gap:6px 16px;margin:0}
.cover dt{color:var(--sub)}.cover dd{margin:0;word-break:break-all}
h2{font-size:22px;margin:40px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}
h3{font-size:18px;margin:0}
.tree{font-family:ui-monospace,Consolas,monospace;font-size:13.5px;background:var(--soft);padding:16px;border-radius:8px;white-space:pre;overflow:auto}
.screen{border:1px solid var(--line);border-radius:10px;padding:20px;margin:22px 0;break-inside:avoid-page}
.screen-head{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px}
.sid{font-family:ui-monospace,Consolas,monospace;background:var(--ink);color:#fff;border-radius:4px;padding:2px 8px;font-size:13px}
.url{color:var(--sub);font-size:13px;word-break:break-all;margin-bottom:14px}
.shot{border:1px solid var(--line);border-radius:6px;max-height:640px;overflow:auto;background:var(--soft);margin-bottom:16px}
.shot img{display:block;width:100%}
.noshot{padding:28px;text-align:center;color:var(--warn);font-size:14px}
table{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 16px}
th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
th{background:var(--soft);font-weight:600;white-space:nowrap}
td.type{white-space:nowrap;color:var(--sub)}
.label{font-weight:600;margin:14px 0 4px}
.desc{white-space:pre-wrap}
.flow{display:grid;grid-template-columns:90px 1fr;gap:4px 12px;font-size:14px}
.flow b{color:var(--sub);font-weight:500}
.miss td:nth-child(2){color:var(--warn);white-space:nowrap}
.foot{margin-top:48px;color:var(--sub);font-size:12px}
@media print{.screen{page-break-inside:avoid}.shot{max-height:none}}
`;

function sitemapTree(screens) {
  const byId = new Map(screens.map((s) => [s.id, s]));
  const kids = new Map();
  const roots = [];
  for (const s of screens) {
    if (s.parentId && byId.has(s.parentId)) {
      if (!kids.has(s.parentId)) kids.set(s.parentId, []);
      kids.get(s.parentId).push(s);
    } else roots.push(s);
  }
  const lines = [];
  const walk = (s, prefix, last, isRoot) => {
    const label = `${s.id}  ${s.title || '(제목 없음)'}  ${s.path}`;
    lines.push(isRoot ? label : `${prefix}${last ? '└─ ' : '├─ '}${label}`);
    const ch = kids.get(s.id) || [];
    ch.forEach((c, i) =>
      walk(c, isRoot ? '' : prefix + (last ? '   ' : '│  '), i === ch.length - 1, false)
    );
  };
  roots.forEach((r) => walk(r, '', true, true));
  return lines.join('\n');
}

function idList(ids, screensById) {
  if (!ids || !ids.length) return '없음';
  return ids
    .map((id) => {
      const s = screensById.get(id);
      return s ? `${id} ${s.title || s.path}` : id;
    })
    .join(', ');
}

/**
 * @param {object} data screens.json 내용
 * @param {object} opt
 *   imageSrc(screen) → img src 문자열(없으면 스크린샷 없음 표시)
 *   descOf(screen) → 기능 설명(편집 반영용, 기본 screen.description)
 */
export function renderDesignDoc(data, opt = {}) {
  const imageSrc = opt.imageSrc || ((s) => s.screenshot || '');
  const descOf = opt.descOf || ((s) => s.description || '');
  const meta = data.meta || {};
  const screens = (data.screens || []).filter((s) => s.status === 'ok');
  const missed = data.uncollected || [];
  const byId = new Map(screens.map((s) => [s.id, s]));

  const sections = screens
    .map((s) => {
      const src = imageSrc(s);
      const shot = src
        ? `<div class="shot"><img src="${esc(src)}" alt="${esc(s.id)} 스크린샷"></div>`
        : `<div class="shot noshot">스크린샷 없음 — 로컬 CLI로 수집하면 채워집니다.</div>`;
      const rows = (s.elements || [])
        .map(
          (e) =>
            `<tr><td>${esc(e.name)}</td><td class="type">${esc(e.type)}</td><td>${esc(e.function)}</td></tr>`
        )
        .join('');
      return `<section class="screen" id="${esc(s.id)}">
<div class="screen-head"><span class="sid">${esc(s.id)}</span><h3>${esc(s.title || '(제목 없음)')}</h3></div>
<div class="url">${esc(s.url)}</div>
${shot}
<div class="label">UI 요소</div>
<table><thead><tr><th>요소</th><th>유형</th><th>기능</th></tr></thead><tbody>${
        rows || '<tr><td colspan="3">추출된 요소 없음</td></tr>'
      }</tbody></table>
<div class="label">기능 설명</div>
<div class="desc">${esc(descOf(s))}</div>
<div class="label">화면 흐름</div>
<div class="flow"><b>진입 경로</b><span>${esc(idList(s.inbound, byId))}</span><b>이동 경로</b><span>${esc(
        idList(s.outbound, byId)
      )}</span></div>
</section>`;
    })
    .join('\n');

  const missRows = missed
    .map((m) => `<tr><td>${esc(m.url)}</td><td>${esc(m.reason)}</td><td>${esc(m.detail || '')}</td></tr>`)
    .join('');

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.siteName || '화면 설계서')} 화면 설계서</title>
<style>${DOC_CSS}</style></head>
<body><main class="doc">
<header class="cover">
<div class="kicker">화면 설계서 · screenshot-docs URL 모드</div>
<h1>${esc(meta.siteName || meta.startUrl || '사이트')}</h1>
<dl>
<dt>URL</dt><dd>${esc(meta.startUrl)}</dd>
<dt>생성일</dt><dd>${esc(meta.generatedAt)}</dd>
<dt>수집 페이지</dt><dd>${screens.length}개 (미수집 ${missed.length}개)</dd>
<dt>탐색 범위</dt><dd>${esc(meta.scopeLabel || '')}</dd>
<dt>뷰포트</dt><dd>${esc(meta.viewport ? `${meta.viewport.width}×${meta.viewport.height}` : '')}</dd>
</dl>
</header>
<h2>사이트맵</h2>
<div class="tree">${esc(sitemapTree(screens)) || '수집된 화면 없음'}</div>
<h2>화면별 설계</h2>
${sections || '<p>수집된 화면이 없습니다.</p>'}
<h2>미수집 목록</h2>
<table class="miss"><thead><tr><th>URL</th><th>사유</th><th>상세</th></tr></thead><tbody>${
    missRows || '<tr><td colspan="3">없음</td></tr>'
  }</tbody></table>
<p class="foot">주식회사 리모 · screenshot-docs URL 모드로 자동 생성. 기능 설명은 화면 구조(aria snapshot·DOM)에서 규칙 기반으로 만든 초안이며 담당자 검토가 필요합니다.</p>
</main></body></html>`;
}
