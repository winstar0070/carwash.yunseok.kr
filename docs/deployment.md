# 배포 및 운영

## Cloudflare Pages 배포 설정

프런트엔드는 정적 파일로 배포합니다. 빌드는 패스키 브라우저 라이브러리를 묶으며 서버 코드는 출력 폴더에 포함하지 않습니다.

- **프레임워크 프리셋 (Framework preset)**: `None`
- **빌드 명령어 (Build command)**: `npm run build`
- **빌드 출력 디렉터리 (Build output directory)**: `dist`
- **환경 변수**: `CARWASH_API_BASE=https://carwash-api.yunseok.kr/api` (기본값과 같으며, 기존에 다른 값을 설정했다면 갱신)
- API는 프런트엔드와 같은 사이트의 HTTPS 도메인으로 연결합니다. 예: `carwash.yunseok.kr` + `carwash-api.yunseok.kr`. 서로 다른 사이트에서는 세션 쿠키가 전달되지 않습니다.
- 현재 화면에 ‘배포 명령’이 필수라면 Workers 설정입니다. Pages의 Git 연동 프로젝트를 생성하고 위 빌드·출력 폴더를 지정하세요.

`wrangler.json`에도 Pages 프로젝트 `carwash-yunseok-kr`의 출력 폴더를 `./dist`로 지정합니다. 기존 프로젝트는 대시보드의 빌드 명령이 `npm run build`인지 확인한 뒤 재배포하세요. 저장소 루트(`.`)를 업로드하거나 루트에서 정적 서버를 실행하면 `.env.example`, Compose 설정, 서버 소스가 공개될 수 있습니다.

빌드는 이전 `dist`를 지운 뒤 계산기 실행에 필요한 HTML·번들·스크립트·PNG만 복사합니다. `.env*`, `src/server/`, `src/shared/`, `db/`, `scripts/`, 저장소 문서는 공개 산출물에 포함하지 않습니다. `public/404.html`로 없는 경로의 계산기 HTML 대체 응답을 막습니다. 배포 후 `/`와 `/config.js`는 정상 응답하고 `/.env.example`, `/.env`, `/compose.yaml`, `/server/app.js`, `/src/server/app.js`, `/db/migrations/0001_vault.sql`는 **404**인지 확인하세요.

## 별도 Docker 서버 실행

Docker Compose로 Node API와 PostgreSQL 17을 함께 실행합니다. SQLite는 사용하지 않습니다. 데이터베이스 포트는 외부에 노출하지 않으며 API는 호스트의 `127.0.0.1:8787`에 연결됩니다.

`.env.example`을 `.env`로 복사한 뒤 `POSTGRES_PASSWORD`에 직접 생성한 긴 임의 값을 넣으세요. 연결 URL에 안전하게 넣으려면 `openssl rand -hex 32`로 생성한 값을 사용하세요. `.env`는 커밋하지 않습니다.

```dotenv
POSTGRES_PASSWORD=직접_생성한_임의의_16진수_값
ORIGIN=https://carwash.yunseok.kr
RP_ID=carwash.yunseok.kr
```

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8787/api/health
```

리버스 프록시에서 `https://carwash-api.yunseok.kr`를 `http://127.0.0.1:8787`로 연결하고 `/api/...` 경로를 그대로 전달하세요. `ORIGIN`은 프런트엔드 주소(끝 슬래시 없음), `RP_ID`는 그 호스트명입니다. 이미 등록한 패스키를 유지하려면 RP_ID를 바꾸지 마세요. 프록시가 다른 컨테이너라면 같은 Docker 네트워크의 `api:8787`로 연결합니다.

보관함 대상 검증 업데이트는 API를 먼저 재배포한 뒤 프런트엔드를 배포하세요. 구형 클라이언트의 대상 ID 없는 요청은 `428`로 거부하므로 열린 페이지를 새로고침해야 합니다. 신형 클라이언트가 구형 API에 연결하면 동기화를 멈추고 서버 업데이트를 안내하며 기기의 변경사항을 보존합니다. 제품 조회는 `GET /api/presets?vaultId=<보관함 ID>`, 저장·로그아웃·복구 코드 재발급은 JSON의 `vaultId`를 필수로 받습니다. 패스키 등록의 options/verify에도 추가할 보관함 ID를 보내며 신규 생성은 명시적으로 `vaultId: null`을 보냅니다.

데이터는 `carwash-data` 볼륨에 영구 저장되며 시작 시 스키마를 적용합니다. 운영 시 별도로 DB 백업을 보관하세요. 다음 명령은 실행한 폴더에 백업 파일을 만듭니다.

```bash
docker compose exec -T db pg_dump -U carwash carwash > carwash-backup.sql
```

요청 제한은 직접 연결 주소 기준입니다. 리버스 프록시 뒤에서는 방문자가 제한을 공유하므로 공개 운영 규모에 맞춰 프록시에서도 요청 제한을 설정하세요.

- 패스키 등록 요청은 IP당 시간당 10회, 서버 전체 시간당 100회까지 허용합니다. 취소한 등록도 요청 횟수에 포함합니다.
- 새 보관함 생성은 IP당 하루 5개, 서버 전체 하루 100개까지 허용합니다. 검증과 저장이 성공한 경우만 생성 횟수에 포함합니다. 기존 보관함에 패스키를 추가할 때는 이 생성 한도를 사용하지 않습니다.
- 시간·일 한도는 UTC 정시·자정에 갱신되며 PostgreSQL에 저장되어 서버 재시작과 여러 API 인스턴스에서도 공유됩니다. 초과 시 `429`와 남은 대기 시간(초)의 `Retry-After` 헤더를 반환합니다. 로그인에는 별도의 기존 요청 제한이 적용됩니다.
- 보관함당 패스키는 최대 10개이며, 동시 등록 시에도 저장 직전에 보관함을 잠그고 한도를 다시 확인합니다.

## 공용 제품 카탈로그

제품 조사 JSON(`schema_version: "1.0.0"`)은 개인 패스키 보관함과 별도인 공용 카탈로그에 저장합니다. API를 실행한 뒤 원본 파일을 표준 입력으로 전달하세요. 원본 파일은 컨테이너 이미지에 포함하지 않습니다.

```bash
docker compose exec -T api node scripts/import-products.mjs - < /path/to/carwash_products.json
curl http://127.0.0.1:8787/api/products
curl http://127.0.0.1:8787/api/products/db-05442
```

- `GET /api/products`: 출처·조사일·비율 기준과 전체 제품 목록을 반환합니다. `?view=picker`를 붙이면 검색 화면에서 사용하지 않는 `research_log`만 제외하며, 제품별 사용 지침·프로필·출처는 유지합니다.
- `GET /api/products/:product_id`: 해당 제품의 옵션·pH 근거·희석·펌프 프로필을 반환합니다. 두 API 모두 로그인 없이 조회하며 HTTP로 수정할 수 없습니다.
- 가져오기는 한 트랜잭션 안에서 제품 목록을 한 번의 배치 upsert로 처리합니다. 같은 `product_id`는 갱신하므로 재실행해도 중복되지 않으며, 파일에 없는 기존 제품과 개인 보관함은 삭제하지 않습니다. 제품이나 메타데이터 저장이 실패하면 배치 전체를 롤백합니다. 최상위 조사 메타데이터는 마지막 가져오기 기준입니다.
- `null`, `unknown`, `calculation_allowed: false`, 단측 희석 상한, 펌프 호환 조건과 출처는 그대로 보존합니다. 소비자는 계산이 허용된 프로필의 명시된 값만 사용해야 하며, 미확인 값을 추정하거나 범위를 임의 보간하지 마세요.

카탈로그 검색·판매 옵션·계산 조건은 [사용 안내](usage.md#제품-검색과-사용-조건)를 참고하세요.

[프로젝트 안내](../README.md)
