// PRD 완료 조건 1~3을 로컬 테스트 사이트로 검증한다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const PORT = 4599;
const OUT = path.resolve('test/output');
const MAX_PAGES = 20;
fs.rmSync(OUT, { recursive: true, force: true });

const { server, hits } = await serve(path.resolve('test-site'), PORT, { slowMs: 6000 });
// 서버가 같은 프로세스에 있으므로 비동기로 실행해야 한다(spawnSync는 서버 응답을 막는다)
await new Promise((resolve) => {
  const child = spawn(process.execPath, ['cli/crawl.mjs', '--url', `http://localhost:${PORT}/`, '--scope', 'domain',
    '--max-pages', String(MAX_PAGES), '--max-depth', '2', '--timeout', '3000', '--out', OUT, '--name', '테스트 사내 포털'],
    { stdio: 'inherit' });
  child.on('exit', resolve);
});

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const data = JSON.parse(fs.readFileSync(path.join(OUT, 'screens.json'), 'utf8'));
const ok = data.screens.filter((s) => s.status === 'ok');

// 조건 1: 최대 페이지 수 이내, 성공 수 == 설계서 화면 섹션 수
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + path.join(OUT, 'design-doc.html'));
const sections = await page.$$eval('section.screen', (els) => els.map((el) => ({
  id: el.id,
  hasImg: !!el.querySelector('.shot img'),
  rows: el.querySelectorAll('tbody tr').length,
  desc: el.querySelector('.desc')?.innerText.trim() || '',
})));
check('1. 최대 페이지 수 이내 수집', ok.length > 0 && ok.length <= MAX_PAGES, `성공 ${ok.length}개 / 제한 ${MAX_PAGES}`);
check('1. screens.json 성공 수 == 화면 섹션 수', ok.length === sections.length, `${ok.length} vs ${sections.length}`);

// 조건 2: 모든 섹션에 스크린샷·UI 요소 표·기능 설명, 깨진 이미지 0
await page.waitForFunction(() => [...document.images].every((i) => i.complete));
const broken = await page.$$eval('img', (imgs) => imgs.filter((i) => i.naturalWidth === 0).map((i) => i.src));
check('2. 모든 섹션 스크린샷 있음', sections.every((s) => s.hasImg));
check('2. 모든 섹션 UI 요소 표 비어있지 않음', sections.every((s) => s.rows > 0));
check('2. 모든 섹션 기능 설명 비어있지 않음', sections.every((s) => s.desc.length > 0));
check('2. 깨진 이미지 0개', broken.length === 0, broken.join(', '));
await browser.close();

// 조건 3: <a href> 이동 외 동작 없음, 실패 페이지는 URL+사유 기록
const actions = fs.readFileSync(path.join(OUT, 'run.log'), 'utf8').trim().split('\n').map((l) => l.split(' ')[1]);
const badActions = actions.filter((a) => !['GOTO', 'SCREENSHOT', 'FETCH', 'FETCH_FAIL'].includes(a));
const nonGet = hits.filter((h) => !h.startsWith('GET ') || h.includes('/api/'));
check('3. 실행 로그에 이동 외 동작 0건', badActions.length === 0, badActions.join(','));
check('3. 서버 기준 폼 제출/비GET 요청 0건', nonGet.length === 0, nonGet.join(','));
const reasons = Object.fromEntries(data.uncollected.map((m) => [new URL(m.url).pathname + '@' + new URL(m.url).host, m.reason]));
const expect = {
  [`/admin@localhost:${PORT}`]: '로그인 필요',
  [`/missing.html@localhost:${PORT}`]: '오류',
  [`/slow@localhost:${PORT}`]: '타임아웃',
  '/@example.com': '범위 밖',
  [`/products/deep/d.html@localhost:${PORT}`]: '최대 깊이 초과',
};
for (const [k, v] of Object.entries(expect)) check(`3. 미수집 기록 ${k.split('@')[0]} (${k.split('@')[1]}) → ${v}`, reasons[k] === v, `실제: ${reasons[k] || '없음'}`);
check('3. 미수집 항목 모두 URL·사유 있음', data.uncollected.every((m) => m.url && m.reason));

server.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
