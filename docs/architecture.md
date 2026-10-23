# 구조 결정과 검증 기록

## 2026-10-23 경로 정리

루트에서 소스·공개 자산·운영 문서를 구분하기 어렵던 문제를 해결하기 위해 역할별 경계를 만들었다. 계산식, 화면 디자인, HTML 내부 CSS·스크립트와 사용자 흐름은 유지한다. 별도 프레임워크나 추가 번들 체계는 도입하지 않았다.

| 이전 경로 | 현재 경로 | 이유 |
| --- | --- | --- |
| `index.html`, 브라우저 JS | `src/client/` | 실행 소스를 한곳에 모음 |
| `server/` | `src/server/` | API 경계 명시 |
| `backup-data.js` | `src/shared/backup-data.js` | 백업 형식·검증 계약을 분리. 현재 API와 테스트에서만 사용하며 브라우저 의존성은 추가하지 않음 |
| `404.html`, `_headers`, `manifest.webmanifest`, `icons/` | `public/` | 그대로 게시하는 자산 구분 |
| `migrations/` | `db/migrations/` | DB 스키마 변경 분리 |
| `DESIGN.md`, `PRODUCT.md` | `docs/` | 승인 기준과 제품 문서를 문서 인덱스로 연결 |
| `AGENT.md` | `AGENTS.md`에 통합 | 자동 발견 지침 한곳에 전체 작업 원칙 보존 |
| 긴 `README.md` | `docs/submission.md`, `usage.md`, `deployment.md`, `development.md` | 제출 역사·사용법·운영법 분리 |

`docs/submission.md`의 날짜·검증 수치·당시 스킬 전문은 2026-10-21 역사 기록이다. 현재 스킬 지침은 `.agents/skills/carwash-submission-review/SKILL.md`이며 새 경로를 따른다. 과거 비공개 상태를 현재 상태로 주장하지 않는다. 기존 `docs/skills/skill-creator/SKILL.md` 참고본도 보존한다.

## 소스 경로와 배포 URL

`npm run build`는 저장소 루트에서 실행하고 `dist/`만 공개한다. `src/client/index.html`을 직접 제공하는 방식은 지원하지 않는다. 브라우저의 `/`, `/sw.js`, `/manifest.webmanifest`, `/icons/*`, `/config.js`, `/pwa.js`, `/catalog-picker.js`, `/catalog-data.js`, `/sync.js` URL은 기존과 같다. `src/`나 `public/` 접두사를 공개 URL에 붙이지 않는다.

빌드는 명시적으로 허용한 자산만 복사한다. `public/` 전체 복사는 하지 않으므로 임시·비공개 파일이 섞여도 게시하지 않는다. 기존 해시 번들, 루트 호환 스크립트, API 설정 주입, 빌드 커밋 표시, 서비스 워커 지문과 캐시 정책을 유지한다. 런타임 파일 내용이 바뀌지 않아 서비스 워커의 기본 캐시 버전은 유지하며 빌드는 기존 지문 규칙을 적용한다.

Docker는 `src/server/`, `src/shared/`, `db/migrations/`, 가져오기 스크립트를 같은 경로로 복사한다. 서버의 SQL 로딩 경로는 모듈 기준 `../../db/migrations/`이고 가져오기 스크립트는 `../src/server/`를 참조한다. 작업 디렉터리에 따라 SQL 경로가 달라지지 않는다.

## 검증 방법

- `npm test`: 계산·동기화·로그인·카탈로그·서비스 워커 및 빌드 회귀 테스트.
- `npm run build`: `dist/` 생성과 번들 해석.
- `tests/build.test.mjs`: 새 입력 경로에서 기존 공개 파일 목록과 URL, 해시·캐시·매니페스트를 확인한다. 오래된 산출물과 `public/` 내부 비공개 canary가 배포되지 않음을 검증한다.
- `TEST_DATABASE_URL=... npm run test:api`: 별도 PostgreSQL에서 API·마이그레이션·카탈로그·계정 경계 통합 검증. 실제 기기 패스키와 구분한다.
- 정적 빌드의 데스크톱·모바일 화면과 계산·저장·불러오기 확인. 캡처는 저장소 밖에 보관한다.

## 이번 수행 결과

- 의존성 미설치 상태의 최초 `npm test`는 실패했다. `npx --yes pnpm@10.28.2 install --frozen-lockfile` 후 수정 전 기준선과 수정 후 최종 `npm test`는 각각 88개 통과, 실패·건너뜀 0개였고 `npm run build`도 통과했다.
- 구현 전에 테스트 입력·import 경로를 새 구조로 바꿔 누락 경로 실패를 확인한 뒤 이동을 구현했다. 새 동작을 추가하지 않았으며 별도의 커버리지 백분율은 측정하지 않았다.
- 고유 Compose 프로젝트 `carwash-path-review-20261023`에서 Docker 이미지를 빌드하고 새 PostgreSQL을 시작했다. `TEST_DATABASE_URL`을 해당 DB에 지정한 `npm run test:api`는 13개 통과, 실패·건너뜀 0개였다. 실제 소프트웨어 인증기 공개키 검증, 3개 마이그레이션, 보관함·카탈로그·계정 경계·정리 작업을 포함한다.
- 컨테이너의 `/api/health`는 `{ "ok": true }`를 반환했다. 이미지 내부 `node scripts/import-products.mjs -`로 테스트 카탈로그 1개를 가져온 뒤 `/api/products/test-shampoo` HTTP 조회가 성공했다. 운영 데이터는 사용하지 않았다.
- 데스크톱 1440×1000과 모바일 390×844 전후 PNG는 각각 바이트까지 동일했다. UI 변화가 없어 비교 테두리는 없다. 물 15L·1:500 → 30ml, 물 1L·1:500 → 2ml, 직접 입력 제품 저장·새로고침 후 보존·목록 클릭으로 1L 복원을 브라우저에서 확인했다.
- T3 preview의 snapshot은 두 차례 모두 `Preview automation snapshot timed out after 15000ms.`로 실패해 Playwright CLI 캡처로 대체했다. 기본 API 설정은 운영 도메인이므로 로컬 원점에서의 세션·카탈로그 요청은 CORS로 차단되었다. 이 상태의 직접 입력·기기 내 저장을 확인했으며, 브라우저와 로컬 API를 연결한 실기기 패스키 검증으로 해석하지 않는다.
- 문서 상대 파일 링크와 남은 소스 경로 참조, `git diff --check`를 확인했다. 참고 스킬 전문은 보존하고 누락된 보조 참조만 2026-10-23 설치본에서 보완한 출처를 제출 문서에 명시했다.
- 실기기 패스키·PWA 설치, 운영 배포·Cloudflare의 실제 404 응답·운영 캐시 갱신은 수행하지 않았다. 커밋·푸시·PR 생성도 수행하지 않았다.
- 임시 Compose를 생성할 때와 동일한 `-p`와 `-f`로 `down --volumes --remove-orphans`를 실행했다. 해당 프로젝트 라벨의 컨테이너와 볼륨 잔존은 0개이며 임시 이미지 태그도 제거했다. 작업 전 사용자 서비스·영구 볼륨은 유지했다. 임시 정적 서버와 Playwright 브라우저도 종료했다.

캡처와 상세 실행 로그는 저장소 밖 `/tmp/carwash-path-review/`에 두었으며 제품 자산으로 커밋하지 않는다. 전후 파일은 `before-desktop.png`, `after-desktop.png`, `before-mobile.png`, `after-mobile.png`이다.
