# 화면 설계서 메이커 (screenshot-docs URL 모드)

URL 하나로 사이트를 탐색해 화면별 스크린샷·UI 요소 표·기능 설명·사이트맵·미수집 목록을 담은 화면 설계서를 만드는 도구입니다. 소스코드에 접근할 수 없는 외부 사이트(고객사 현행 시스템, 경쟁 서비스)도 문서화할 수 있습니다.

- **한 줄 소개**: 내 업무에서 현행 시스템 화면 캡처와 화면 설계서 정리를 해 주는 서비스
- **판단 지점**: 사람이 판단할 지점은 자동 생성된 기능 설명이 실제 화면 의도와 맞는지다
- **사용 도구**: Claude Code, Playwright, Vercel

주식회사 리모 (REMO Inc.)

## 구성

| 경로 | 역할 |
|---|---|
| `cli/crawl.mjs` | 수집기. Playwright로 BFS 탐색 → `screens.json`, `screenshots/*.png`, `design-doc.html`, `run.log` |
| `web/` | 업무용 웹 (Vercel 배포 대상). ① 수집 명령 만들기 ② 설계서 검토·수정·내보내기 |
| `web/render.js` | `screens.json` → 설계서 HTML 렌더러. CLI와 웹이 같이 씀 |
| `web/samples/` | 샘플: 테스트 사내 포털(스크린샷 포함), AX Campus 종로(구조) |
| `test-site/`, `test/` | 완료 조건 검증용 테스트 사이트와 테스트 |

## 수집기 사용

```bash
npm install
npx playwright install chromium        # 최초 1회
node cli/crawl.mjs --url "https://finger-ax-campus.vercel.app/event/jongno" --scope prefix --max-pages 30 --max-depth 3 --viewport 1440x900 --out output
```

| 옵션 | 설명 | 기본값 |
|---|---|---|
| `--scope domain\|prefix` | 탐색 범위 | `prefix` |
| `--prefix <경로>` | prefix 범위 | 시작 URL 경로 |
| `--max-pages <n>` | 최대 페이지 수 | 30 |
| `--max-depth <n>` | 최대 깊이(시작=0) | 3 |
| `--viewport <WxH>` | 뷰포트 | 1440x900 |
| `--storage-state <파일>` | 로그인 영역용 storageState | 없음 |
| `--urls <파일>` | 추가 URL 목록(JS 라우팅 보완) | 없음 |
| `--sitemap` | sitemap.xml URL 보조 입력 | 끔 |
| `--timeout <ms>` | 페이지당 타임아웃 | 30000 |

기본값 30·3·1440x900은 PRD의 미정 값 `[ ]`을 대신한 임시값입니다. 확정되면 옵션으로 바꿔 쓰면 됩니다.

### 안전 규칙
- 탐색은 `page.goto`로 `<a href>` 주소만 엽니다. 클릭·입력·폼 제출을 하지 않습니다. `run.log`에는 `GOTO`/`SCREENSHOT`/`FETCH`만 남습니다.
- 로그인은 사용자가 준비한 `storageState.json`으로만 접근합니다. 비밀번호를 입력하지 않습니다.
  - 준비 예: `npx playwright codegen --save-storage=storageState.json <로그인 URL>` 에서 직접 로그인 후 창을 닫습니다.
- 실패 페이지는 `미수집 목록`에 URL과 사유(로그인 필요 / 타임아웃 / 오류 / 범위 밖 / 최대 깊이 초과 / 최대 페이지 수 초과 / 중복)를 남깁니다.

## 테스트 (PRD 완료 조건 1~3)

```bash
npm test
```

로컬 테스트 사이트(정상 7개, 401·404·지연·외부·깊이 초과 링크 포함)를 수집하고 14개 항목을 검사합니다: 성공 수 = 설계서 섹션 수, 모든 섹션의 스크린샷·UI 요소 표·기능 설명, 깨진 이미지 0, 이동 외 동작 0건, 서버 기준 POST 0건, 미수집 사유 정확성.

## 웹 로컬 실행

```bash
npm run serve      # http://localhost:5173
```

## Vercel 배포

`vercel.json`이 `web/`을 정적 사이트로 배포하도록 설정돼 있습니다(빌드 없음).

1. GitHub에 **Public** 저장소로 push
2. Vercel → Add New Project → 저장소 Import → 설정 그대로 Deploy
3. Settings → Deployment Protection → Vercel Authentication **Disabled**
4. 시크릿 창에서 `https://<프로젝트>.vercel.app` 이 로그인 없이 열리는지 확인

## 알려진 한계

- `<a href>` 없이 JS 라우팅만 쓰는 SPA는 링크 수집이 적을 수 있습니다. `--sitemap` 또는 `--urls`로 보완합니다.
- 기능 설명은 aria snapshot·DOM 구조 기반 규칙으로 만든 초안입니다. 클릭해야 드러나는 동작(모달, 탭 전환)은 "미확인"으로 표시되며 사람이 검토해 고칩니다.
- `web/samples/jongno`는 작업 환경에서 대상 사이트 접속이 막혀 텍스트 조회로 구조만 정리한 샘플입니다. 위 명령을 로컬에서 실행하면 스크린샷까지 채워진 설계서가 나옵니다.
