# carwash.yunseok.kr — 세차 희석비율 계산기

물을 먼저 받아둔 뒤, 원액:물 비율 `1:N` 또는 완성액 원액 농도에 맞춰 넣을 케미컬 원액량을 계산하는 정적 웹 앱입니다.

**[중간고사 과제 제출 문서 — PRD · Todo · 변경 근거 · 스킬 · 회고](docs/submission.md)**
2026-10-21 제출 기록을 보존합니다. 현재 구조와 검증 결과는 [구조 결정 기록](docs/architecture.md)에서 확인하세요.

- 서비스: <https://carwash.yunseok.kr>
- 코드: <https://github.com/winstar0070/carwash.yunseok.kr>
- 물 용량·희석비율·농도 계산, 제품별 펌프 횟수와 별도 계량량
- 내 케미컬 저장·수정·불러오기, 공용 제품 검색과 판매 옵션·사용 방법 확인
- 선택적 패스키 보관함과 자동 동기화, 오프라인 계산과 홈 화면 설치

## 빠른 실행

Node.js 24 LTS와 pnpm 10.28.2(`package.json`의 `packageManager`)를 준비한 뒤 저장소 루트에서 실행합니다. 정적 파일 제공에는 Python 3을 사용합니다.

```bash
corepack enable
pnpm install --frozen-lockfile
npm run build
python3 -m http.server 8766 --directory dist
```

<http://localhost:8766>에서 계산과 기기 내 저장을 확인할 수 있습니다. 패스키·동기화·최신 카탈로그에는 별도 API가 필요합니다. API 연결과 테스트는 [개발 안내](docs/development.md), 공개 배포는 [운영 안내](docs/deployment.md)를 따릅니다. 공개하는 디렉터리는 `dist/`입니다.

## 디렉터리

| 경로 | 역할 |
| --- | --- |
| `src/client/` | 계산기 HTML, 브라우저 모듈, 서비스 워커 소스 |
| `src/server/` | 패스키·보관함·카탈로그 API |
| `src/shared/` | 백업 데이터 형식 검증 모듈 (현재 API·테스트에서 사용) |
| `public/` | 허용 목록으로 배포하는 매니페스트·아이콘·헤더·404 |
| `db/migrations/` | PostgreSQL 스키마 변경 |
| `scripts/` | 정적 빌드·아이콘 생성·카탈로그 가져오기 |
| `tests/` | 단위·회귀·PostgreSQL 통합 테스트 |
| `docs/` | 제출·사용·개발·운영·디자인 문서 |
| `dist/` | 빌드 산출물 (Git 제외) |

루트의 `package.json`, `Dockerfile`, `compose.yaml`, `wrangler.json`은 실행·배포 진입점입니다. `.agents/`와 `.impeccable/`은 도구가 발견하는 기존 위치를 유지합니다. 소스 이동과 공개 URL의 관계는 [구조 결정 기록](docs/architecture.md)에 정리했습니다.

## 문서

- [과제 제출 기록](docs/submission.md)
- [사용 안내](docs/usage.md)
- [개발과 테스트](docs/development.md)
- [배포·Docker 운영·제품 가져오기 API](docs/deployment.md)
- [구조 결정과 이번 검증](docs/architecture.md)
- [제품 요구사항](docs/PRODUCT.md) · [승인된 디자인](docs/DESIGN.md)
- [에이전트 작업 원칙](AGENTS.md)

## 변경 검증

```bash
npm test
npm run build
```

API 통합 테스트에는 별도의 테스트용 PostgreSQL이 필요합니다. 실행 방법은 [개발과 테스트](docs/development.md)를 참고하세요. 운영 DB나 개인 보관함 데이터를 테스트·이슈·PR에 포함하지 마세요. `.env.example`에는 설정 이름과 예시만 두고 실제 값은 Git에서 제외되는 `.env`에 보관합니다.

## 라이선스

프로젝트 코드는 [MIT License](LICENSE)로 제공합니다. 포함된 외부 스킬 문서와 의존성은 각자의 라이선스를 따릅니다. 자세한 구분은 [외부 자료 고지](THIRD_PARTY_NOTICES.md)를 참고하세요.

`package.json`의 `private: true`는 실수로 npm 패키지를 배포하지 않기 위한 설정이며 GitHub 저장소의 공개 여부와는 별개입니다.
