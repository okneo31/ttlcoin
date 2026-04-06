# TTL Coin Project Handover

## 프로젝트 개요

TTL Coin(That's The Labor Coin)은 go-ethereum v1.13.15 포크 기반의 Clique PoA 블록체인.

- **Chain ID**: 7777
- **블록 시간**: 5초
- **블록 보상**: 7,777 TTL (서명자 수에 따라 균등 분배)
- **최대 공급량**: 777,700,000,000 TTL
- **GitHub**: https://github.com/okneo31/ttlcoin

---

## 서버 구성

### 서버1 (207.90.195.148) - Ubuntu
- **역할**: 서명자 A + 메인 인프라
- **서명자 주소**: `0x49b60177cC7DcD4EC4477a7F9fC42F18fE40CeC4`
- **서비스**:
  - `ttlcoin.service` - 메인 노드 (포트 8545/8546/30303)
  - `ttlcoin-explorer.service` - 블록 익스플로러 (포트 3000)
  - `ttlcoin-wallet.service` - 지갑 API + TX 인덱서 (포트 4000)
  - `ttlcoin-backup-ipfs.service` - Filebase IPFS 블록 백업 (5000블록마다)
- **데이터 디렉토리**: `/home/ttl/.ttlcoin/`
- **geth 바이너리**: `/home/ttl/ttlcoin/src/build/bin/geth` (v1.13.15 커스텀)
- **geth v1.13 소스**: `/home/ttl/ttlcoin-v13/`

### 서버2 (207.90.195.147) - Ubuntu
- **역할**: 서명자 B + 관리자 패널
- **서명자 주소**: `0xbF073bFbEbA9a5DE28475C532D8174850EDd6A68`
- **서비스**:
  - `ttlcoin-backup.service` - 서명자 노드
  - `ttlcoin-admin.service` - 관리자 패널 (포트 9090)
- **데이터 디렉토리**: `/home/ttl/.ttlcoin-backup/`
- **geth 바이너리**: `/usr/local/bin/ttlcoin-geth`
- **관리자 키**: `392766sm!!` (환경변수 ADMIN_KEY)
- **keystore 위치**: `/home/ttl/.ttlcoin-backup/geth/keystore/` (geth 1.13은 geth/ 하위)

### 서버3 (207.90.195.149) - Ubuntu (GUI Desktop)
- **역할**: 서명자 C + 웹 지갑
- **서명자 주소**: `0x0b551D8B57B8A7B7072Eb40D1d6DefB148e60434`
- **서비스**:
  - `ttlcoin.service` - 서명자 노드
  - `ttlcoin-wallet.service` - 웹 지갑 (포트 8080)
- **데이터 디렉토리**: `/home/ttl/.ttlcoin-node/`
- **geth 바이너리**: `/usr/local/bin/ttlcoin-geth`
- **데스크탑 지갑**: `/home/ttl/TTL Coin Wallet-1.0.0.AppImage`

### 서버4 (207.90.195.153) - Windows 11
- **역할**: 서명자 D
- **서명자 주소**: `0x9F38dbc8749fB820D5956F0e42c66C60d145Aeea`
- **서비스**:
  - `TTLCoin` - Windows 서비스 (NSSM으로 등록)
  - `TTLWallet` - 지갑 웹서비스 (NSSM, 포트 8080)
- **데이터 디렉토리**: `C:\Users\ttl\.ttlcoin\`
- **geth 바이너리**: `C:\Users\ttl\ttlcoin.exe`
- **NSSM 위치**: `C:\Users\ttl\nssm\nssm-2.24\win64\nssm.exe`
- **지갑 앱 빌드**: `C:\Users\ttl\wallet-app\dist\TTL Coin Wallet Setup 1.0.0.exe`
- **SSH 접속**: `ttl@207.90.195.153` (ed25519 키)
- **주의**: password.txt에 공백+CRLF 포함되어 있음 (비밀번호: `ttlcoin7777  `)

---

## 도메인 및 SSL

| 도메인 | 서버 | 포트 | 서비스 |
|--------|------|------|--------|
| `rpc.ttl1.top` | 서버1 (.148) | 8545 | JSON-RPC (nginx 프록시, RPC 캐싱 적용) |
| `ws.ttl1.top` | 서버1 (.148) | 8546 | WebSocket |
| `scan.ttl1.top` | 서버1 (.148) | 3000 | 블록 익스플로러 |
| `api.ttl1.top` | 서버1 (.148) | 4000 | 지갑 API + TX 인덱서 |
| `admin.ttl1.top` | 서버2 (.147) | 9090 | 관리자 패널 |
| `wallet.ttl1.top` | 서버3 (.149) | 8080 | 웹 지갑 (ID 로그인) |

- SSL: Let's Encrypt (certbot --nginx)
- DNS: 모두 A 레코드, `207.90.195.x`로 설정
- nginx 설정: `/etc/nginx/sites-available/ttlcoin` (서버1), `/etc/nginx/sites-available/ttlcoin-admin` (서버2), `/etc/nginx/sites-available/ttlcoin-wallet` (서버3)

---

## 프로젝트 디렉토리 구조 (`/home/ttl/ttlcoin/`)

```
ttlcoin/
├── src/                        # geth 포크 (go-ethereum v1.13.15 기반, v1.14에서 다운그레이드)
│   ├── cmd/geth/main.go        # clientIdentifier = "ttlcoin"
│   ├── consensus/clique/       # 블록 보상 7,777 TTL 로직 (Finalize 함수)
│   ├── params/protocol_params.go  # TTLBlockReward, TTLMaxTotalSupply
│   ├── eth/handler.go          # full sync 강제 (snap sync 자동전환 방지)
│   ├── eth/protocols/eth/handlers.go  # NewBlock/NewBlockHashes 수신 허용 (에러→무시)
│   └── eth/api_debug.go        # InsertRawBlock API 추가 (미사용)
│
├── genesis.json                # chainId:7777, clique period:5, epoch:30000
│
├── explorer/                   # 블록 익스플로러 (Express + vanilla JS)
│   ├── server.js               # RPC 프록시, REST API, WebSocket 실시간 업데이트
│   ├── public/                 # SPA (History API 라우팅, #/ 아님)
│   └── package.json
│
├── wallet-api/                 # 지갑 API + TX 인덱서
│   ├── server.js               # Express API 서버 (포트 4000)
│   ├── db.js                   # SQLite (better-sqlite3) 스키마
│   ├── indexer.js              # 블록 폴링 → SQLite 인덱싱
│   └── package.json
│
├── wallet-app/                 # 데스크탑 지갑 (Electron)
│   ├── main.js                 # geth 내장, heartbeat, 채굴 기능
│   ├── preload.js              # contextBridge API
│   ├── ui/index.html           # UI (Send/Receive/Mine/Backup)
│   ├── bin/                    # geth-linux, geth-win.exe, genesis.json
│   ├── icon.png/ico/icns       # TTL 로고
│   ├── package.json            # electron-builder 설정, extraResources
│   └── dist/                   # 빌드 결과물 (.AppImage, .exe)
│
├── wallet-gui/                 # 웹 지갑 (ID 로그인 방식)
│   ├── server.js               # Express + bcrypt 인증, 프라이빗키 AES 암호화 저장
│   ├── public/                 # 로그인/회원가입 UI
│   ├── users.db                # 사용자 DB (SQLite)
│   └── package.json
│
├── admin-panel/                # 관리자 패널
│   ├── server.js               # 채굴자 신청 관리, 자동 clique.propose, 노드 모니터링
│   ├── public/                 # 관리자 UI
│   ├── admin.db                # 신청/노드 DB (SQLite)
│   └── package.json
│
├── mining-pool/                # 채굴 풀 스마트 컨트랙트 (현재 미사용)
│   ├── MiningPool.sol          # Solidity 컨트랙트 (evmVersion: paris)
│   ├── deploy.js               # 배포 스크립트 (이미 배포됨: 0xed4e1b7d...)
│   ├── distributor.js          # 보상 분배 스크립트 (현재 중지됨)
│   └── config.json             # 컨트랙트 주소, owner 키
│
├── anchor/                     # Polygon 앵커링 (코드 준비, 미배포)
│   ├── TTLAnchor.sol           # Polygon에 TTL 블록해시 저장
│   ├── deploy.js               # 배포 스크립트
│   ├── anchor.js               # 앵커링 서비스
│   └── package.json
│
├── ipfs-backup/                # Filebase IPFS 백업
│   ├── backup.js               # S3 API로 Filebase 업로드 (5000블록마다)
│   ├── .env                    # Filebase 키 (FILEBASE_KEY, FILEBASE_SECRET)
│   └── backup-state.json       # 마지막 백업 블록
│
├── block-sync.js               # 블록 동기화 스크립트 (미사용, geth 1.13에서 불필요)
│
├── nginx-ttlcoin.conf          # nginx 설정 (RPC 캐싱 포함)
├── ttlcoin.service             # 서버1 메인 노드 systemd
├── ttlcoin-backup.service      # 서버2 노드 systemd
├── ttlcoin-explorer.service    # 익스플로러 systemd
├── ttlcoin-wallet.service      # 지갑 API systemd
├── ttlcoin-backup-ipfs.service # IPFS 백업 systemd
├── ttlcoin-pool.service        # 채굴 풀 systemd (현재 disabled)
│
├── ttl_keys.md.enc             # 서명자 프라이빗 키 (AES-256 암호화, 비밀번호: ttlcoin7777)
└── README.md                   # 프로젝트 문서
```

---

## geth 커스텀 변경 사항 (v1.13.15 기반)

### 1. 클라이언트 이름
- `cmd/geth/main.go`: `clientIdentifier = "ttlcoin"`

### 2. 블록 보상
- `params/protocol_params.go`: `TTLBlockReward = 7777 * 10^18 wei`, `TTLMaxTotalSupply = 777,700,000,000 * 10^18`
- `consensus/clique/clique.go` Finalize 함수: 블록 보상을 서명자들에게 균등 분배, 최대 공급량 체크

### 3. 동기화 관련 (v1.14 패치, v1.13에서는 불필요)
- `eth/handler.go`: full sync 강제 (snap sync 자동전환 방지)
- `eth/protocols/eth/handlers.go`: NewBlock/NewBlockHashes 허용 (v1.14에서 제거된 것 복구)
- `eth/api_debug.go`: InsertRawBlock API 추가

### 4. v1.14 → v1.13 다운그레이드 이유
- geth v1.14에서 PoA 프라이빗 체인의 피어 간 블록 전파가 제거됨 (beacon chain 전환)
- 백업 노드 동기화 불가능
- v1.13.15로 다운그레이드하여 해결

---

## 서명자 관리

### 현재 서명자 (4명)
```
A: 0x49b60177cC7DcD4EC4477a7F9fC42F18fE40CeC4 (서버1)
B: 0xbF073bFbEbA9a5DE28475C532D8174850EDd6A68 (서버2)
C: 0x0b551D8B57B8A7B7072Eb40D1d6DefB148e60434 (서버3)
D: 0x9F38dbc8749fB820D5956F0e42c66C60d145Aeea (서버4)
```

### 서명자 추가 방법
1. 지갑 앱/웹에서 채굴 신청 → admin.ttl1.top에서 Approve
2. 또는 geth console에서 수동: `clique.propose("0x주소", true)`
3. 기존 서명자 과반수 투표 필요 (4명 중 3명)

### 서명자 제거
- `clique.propose("0x주소", false)` 과반수 투표
- admin.ttl1.top에서 Remove Signer 버튼

### 중요: 서명자 = 채굴자
- 서명자로 등록되면 노드를 안 돌려도 보상을 받음 (다른 서명자가 대신 블록 생성)
- 보상: 7,777 TTL / 블록 ÷ 서명자 수

---

## 데스크탑 지갑 (Electron)

### 빌드
```bash
cd /home/ttl/ttlcoin/wallet-app

# Linux
npx electron-builder --linux AppImage

# Windows (Windows 서버에서)
npx electron-builder --win nsis
```

### 내장 기능
- geth 바이너리 포함 (bin/geth-linux, bin/geth-win.exe)
- 앱 실행 시 자동으로 geth 노드 시작 (포트 18545, P2P 30303)
- `--bootnodes` 로 4대 서명자 서버에 연결
- 60초마다 admin.ttl1.top에 heartbeat 전송
- 채굴 승인 후 "Start Mining Now" → geth가 --mine 모드로 재시작

### MAX 전송
- `type: 0` (레거시 트랜잭션) 사용
- `maxFeePerGas` 기반으로 가스비 계산 후 잔액에서 차감

---

## 웹 지갑 (ID 로그인)

### 인증 구조
- 회원가입 시 지갑 자동 생성
- 프라이빗 키는 사용자 비밀번호로 AES-256-CBC 암호화 후 SQLite 저장
- 로그인 시 세션 토큰 발급 (24시간), 비밀번호는 세션에 저장 (키 복호화용)
- 전송 시 비밀번호 재확인 없음 (세션의 비밀번호로 자동 복호화)

### DB: users.db
- `users` 테이블: username, password_hash (bcrypt), address, encrypted_key
- `sessions` 테이블: token, username, password, expires_at

---

## 관리자 패널

### 기능
- Network Nodes: 서버 노드 4대 + 지갑 노드 (heartbeat 기반) 통합 표시
- Miner Applications: 채굴 신청 목록, Approve/Reject
- Approve 시: 4대 서버에 자동 `clique.propose` 실행
- Reject 시: DB에서 삭제
- 지갑 노드: 10분 오프라인 시 자동 삭제, 수동 X 버튼 삭제

### 인증
- Admin Key: `392766sm!!` (환경변수 ADMIN_KEY)
- 헤더: `x-admin-key`

---

## nginx RPC 캐싱

서버1의 nginx에 RPC 캐싱 적용:
```nginx
proxy_cache_path /tmp/rpc_cache levels=1:2 keys_zone=rpc_cache:10m max_size=100m inactive=3s;
proxy_cache rpc_cache;
proxy_cache_methods POST;
proxy_cache_key "$request_body";
proxy_cache_valid 200 1s;
```

---

## IPFS 백업 (Filebase)

- **Filebase 버킷**: `ttlcoin-backup`
- **Access Key**: `5C046EF5C142C31E64C6`
- **Secret Key**: `7LH4akBzfvrxv10r65NVrtJk1tQl8uxSLiV9dUwB`
- **주기**: 5,000 블록마다 (약 7시간)
- **저장**: S3 API → Filebase IPFS 핀닝
- **무료 한도**: 5GB / 1,000 파일 (약 10개월)

---

## Polygon 앵커링 (미배포)

- 코드: `/home/ttl/ttlcoin/anchor/`
- 스마트 컨트랙트 `TTLAnchor.sol` 준비 완료
- 배포 시 필요: Polygon 지갑 + MATIC
- 100블록마다 TTL 블록해시를 Polygon에 기록
- 목적: PoA 체인 무결성 증명

---

## 채굴 풀 스마트 컨트랙트 (현재 미사용)

- 컨트랙트: `0xed4e1b7d86F45859ED3AbC24A238cF97f1220F19` (TTL 체인에 배포됨)
- 위임 채굴용으로 만들었으나, 서명자 직접 추가 방식이 더 간단해서 미사용
- Solidity 컴파일 시 `evmVersion: paris` 필수 (PUSH0 미지원)
- `ttlcoin-pool.service`는 disabled 상태

---

## 암호화된 키 파일

- 파일: `/home/ttl/ttlcoin/ttl_keys.md.enc`
- 복호화: `openssl enc -aes-256-cbc -d -pbkdf2 -in ttl_keys.md.enc -out ttl_keys.md -pass pass:ttlcoin7777`
- 내용: 서명자 A/B/C/D 프라이빗 키, 네트워크 정보

---

## 주요 비밀번호/키

- geth 계정 비밀번호: `ttlcoin7777` (서버1/2/3), 서버4는 공백 포함
- 관리자 패널 키: `392766sm!!`
- 키 파일 암호: `ttlcoin7777`
- GitHub: `okneo31`
- 사용자: Neo (CEO of TTL Inc.)

---

## 알려진 이슈

1. **서버4 Windows password.txt**: `echo`로 생성 시 공백+CRLF 포함. 비밀번호가 `ttlcoin7777  \r\n`
2. **geth v1.14 비호환**: PoA 체인에서 피어 블록 전파 제거됨. v1.13.15 사용 필수
3. **static-nodes.json**: geth 1.13에서 datadir 루트에 위치해야 함
4. **Electron 앱 --nodiscover**: bootnodes와 같이 사용 불가. --nodiscover 제거해야 피어 연결됨
5. **Solidity PUSH0**: geth 1.13 체인에서 Solidity 0.8.20+ 컴파일 시 `evmVersion: paris` 필수
6. **익스플로러 서명자 표시**: Clique에서 miner 필드가 0x0 반환. clique_getSigners RPC로 서명자 조회

---

## 향후 과제

1. Polygon 앵커링 배포 (Polygon 지갑 + MATIC 필요)
2. 서명자 많아지면 블록 생성 간격 조정 고려
3. 인덱서 SQLite → PostgreSQL 전환 (사용자 증가 시)
4. 지갑 앱 자동 업데이트 기능
5. 모바일 지갑 (React Native 또는 Flutter)
