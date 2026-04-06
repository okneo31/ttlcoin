# TTL Coin (That's The Labor Coin)

TTL Coin은 Clique PoA 합의 기반의 블록체인 네트워크입니다.

- **Chain ID**: 7777
- **블록 시간**: 5초
- **블록 보상**: 7,777 TTL
- **최대 공급량**: 777,700,000,000 TTL

## 네트워크 정보

| 서비스 | URL |
|--------|-----|
| RPC (HTTPS) | `https://rpc.ttl1.top` |
| WebSocket | `wss://ws.ttl1.top` |
| 블록 익스플로러 | `https://scan.ttl1.top` |
| 지갑 API | `https://api.ttl1.top` |
| 관리자 패널 | `https://admin.ttl1.top` |

## MetaMask 네트워크 추가

| 항목 | 값 |
|------|-----|
| 네트워크 이름 | TTL Coin |
| RPC URL | `https://rpc.ttl1.top` |
| 체인 ID | `7777` |
| 통화 기호 | `TTL` |
| 블록 익스플로러 | `https://scan.ttl1.top` |

---

## 데스크탑 지갑 설치

### Windows

1. `TTL Coin Wallet Setup 1.0.0.exe` 다운로드
2. 더블클릭으로 설치
3. 바탕화면 아이콘 실행

**포트 개방 (PowerShell 관리자 실행):**
```powershell
New-NetFirewallRule -Name ttlwallet -DisplayName 'TTL Wallet Node' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 30303
```
```powershell
New-NetFirewallRule -Name ttlwalletudp -DisplayName 'TTL Wallet Node UDP' -Enabled True -Direction Inbound -Protocol UDP -Action Allow -LocalPort 30303
```

> 포트를 열지 않아도 기본 동작(지갑 송수신, 동기화)은 가능합니다. 포트를 열면 다른 노드가 내 PC에 직접 연결할 수 있어 네트워크에 기여합니다.

### Linux (Ubuntu)

1. `TTL Coin Wallet-1.0.0.AppImage` 다운로드
2. 실행 권한 부여 및 실행:
```bash
chmod +x 'TTL Coin Wallet-1.0.0.AppImage'
./'TTL Coin Wallet-1.0.0.AppImage'
```

**필수 패키지 (최초 1회):**
```bash
sudo apt install libfuse2
```

**방화벽 개방 (선택):**
```bash
sudo ufw allow 30303/tcp
sudo ufw allow 30303/udp
```

---

## 지갑 기능

| 기능 | 설명 |
|------|------|
| 지갑 생성 | 니모닉 + 프라이빗 키 자동 생성 |
| 지갑 가져오기 | 프라이빗 키 또는 니모닉으로 가져오기 |
| TTL 전송 | 주소 입력 후 전송, MAX 버튼으로 전액 전송 |
| TTL 수신 | QR 코드 + 주소 복사 |
| 트랜잭션 내역 | 과거 송수신 기록 조회 |
| 지갑 백업 | 프라이빗 키 / 니모닉 확인 |
| 채굴 신청 | Mine 버튼으로 채굴자 신청 → 관리자 승인 후 채굴 시작 |
| 내장 노드 | 앱 실행 시 자동으로 TTL 네트워크 노드 참여 |

---

## 채굴 참여 방법

1. 지갑 앱에서 **Mine** 버튼 클릭
2. 이름 입력 후 **Apply to Mine** 클릭
3. 관리자 승인 대기
4. 승인 후 Mine 다시 클릭 → **Start Mining Now** 클릭
5. 내 PC에서 직접 블록 생성 시작, 보상 자동 수령

> 채굴이 시작되면 앱을 꺼도 보상은 계속 쌓입니다 (서명자로 등록되면 다른 노드가 대신 블록 생성).

---

## 프로젝트 구조

```
ttlcoin/
├── src/                    # geth 포크 (go-ethereum v1.13.15 기반)
├── genesis.json            # 제네시스 블록 설정
├── explorer/               # 블록 익스플로러 (scan.ttl1.top)
├── wallet-api/             # 지갑 API + TX 인덱서 (api.ttl1.top)
├── wallet-app/             # 데스크탑 지갑 (Electron)
├── wallet-gui/             # 웹 지갑
├── admin-panel/            # 관리자 패널 (admin.ttl1.top)
├── mining-pool/            # 채굴 풀 스마트 컨트랙트
├── anchor/                 # Polygon 앵커링 컨트랙트
├── ipfs-backup/            # Filebase IPFS 블록 백업
├── nginx-ttlcoin.conf      # Nginx 설정 (RPC 캐싱 포함)
└── *.service               # systemd 서비스 파일
```

---

## 서버 노드 구성 (운영자용)

### geth 노드 설치

```bash
# 바이너리 복사
cp ttlcoin-geth /usr/local/bin/

# 데이터 디렉토리 초기화
ttlcoin-geth --datadir /home/ttl/.ttlcoin init genesis.json

# 계정 생성
ttlcoin-geth account new --datadir /home/ttl/.ttlcoin --password /home/ttl/.ttlcoin/password.txt

# 노드 실행
ttlcoin-geth \
  --datadir /home/ttl/.ttlcoin \
  --networkid 7777 \
  --port 30303 \
  --http --http.addr 0.0.0.0 --http.port 8545 \
  --http.api eth,net,web3,admin,clique,miner,txpool \
  --mine --miner.etherbase <주소> \
  --unlock <주소> --password /home/ttl/.ttlcoin/password.txt \
  --allow-insecure-unlock \
  --syncmode full --gcmode full
```

### 서명자(채굴자) 추가

기존 서명자 과반수가 투표해야 승인됩니다:
```javascript
// geth console 또는 admin 패널에서
clique.propose("0x새주소", true)   // 추가
clique.propose("0x주소", false)    // 제거
clique.getSigners()                // 현재 서명자 목록
```

### 서버 포트

| 포트 | 용도 |
|------|------|
| 30303 (TCP/UDP) | P2P 노드 통신 |
| 8545 | HTTP RPC |
| 8546 | WebSocket |

---

## 라이선스

GPL-3.0
