# TTL Coin - That's The Labor Coin

## 프로젝트 개요

TTL Coin은 go-ethereum(Geth) v1.14.12를 포크하여 만드는 **허가형 PoA(Proof of Authority) 블록체인**입니다.
기존 이더리움의 블록 생성자 독식 보상 구조를 변경하여, **모든 허가된 채굴자에게 블록 보상을 균등 분배**하는 커스텀 합의 메커니즘을 구현합니다.

- **회사**: TTL Inc. (주식회사 티티엘)
- **CEO/개발자**: 니오 (Jaehyun)
- **기존 프로젝트**: no1coin (Geth v1.13.15 포크) → TTL Coin으로 리브랜딩 + 신규 체인

---

## 핵심 스펙

| 항목 | 값 |
|------|-----|
| 이름 | **TTL Coin** |
| 티커/단위 | **TTL** (기존 ETH 대체) |
| 슬로건 | **That's The Labor Coin** |
| 베이스 코드 | **go-ethereum v1.14.12** |
| Go 버전 | **Go 1.22.x** |
| 체인 ID | **7777** |
| 네트워크 ID | **7777** |
| 합의 알고리즘 | **PoA (Clique) - 허가형** |
| 블록 시간 | **5초** |
| 블록 보상 | **7,777 TTL / 블록** |
| 보상 분배 | **전체 허가 채굴자에게 균등 분배** (기존 PoA의 블록 생성자 독식 방식 변경) |
| 반감기 | **없음** |
| 최대 발행량 (Max Supply) | **777,700,000,000 TTL** (7,777억 TTL) |
| 맥스캡 도달 예상 | **약 15.9년** |
| 맥스캡 도달 후 | **발행 중단 (보상 0)** |
| 가스 리밋 (초기) | **30,000,000** |

---

## 보상 분배 메커니즘 (핵심 커스텀)

### 기존 PoA (Clique) 방식
```
블록 생성자 1명이 전체 보상 독식
채굴자 100명이면 → 내 차례에만 보상 받음 (라운드 로빈)
```

### TTL Coin 커스텀 방식
```
블록 생성 시 → 전체 허가된 채굴자(signers)에게 균등 분배
7,777 TTL ÷ 채굴자 수 = 1인당 보상

예시: 채굴자 100명
매 블록(5초) → 100명 전원에게 각 77.77 TTL 지급
```

### 채굴자 수별 1인당 보상

| 채굴자 수 | 1인당/블록 | 1인당/일 | 1인당/년 |
|-----------|-----------|---------|---------|
| 1명 | 7,777 TTL | 1.34억 | 490억 |
| 10명 | 777.7 TTL | 1,343만 | 49억 |
| 50명 | 155.54 TTL | 268만 | 9.8억 |
| 100명 | 77.77 TTL | 134만 | 4.9억 |
| 500명 | 15.554 TTL | 26.8만 | 0.98억 |

---

## 발행량 계산

```
블록 보상: 7,777 TTL
블록 시간: 5초
블록/분: 12
블록/일: 17,280
블록/년: 6,307,200

일일 발행: 7,777 × 17,280 = 134,386,560 TTL (약 1.34억/일)
연간 발행: 7,777 × 6,307,200 = 49,051,094,400 TTL (약 490억/년)

최대 발행량: 777,700,000,000 TTL
맥스캡 도달: 777,700,000,000 ÷ 49,051,094,400 ≈ 15.9년
```

---

## 소스 코드 수정 가이드

### 1. Geth 클론 및 체크아웃

```bash
git clone https://github.com/ethereum/go-ethereum.git ttlcoin
cd ttlcoin
git checkout v1.14.12
```

### 2. 핵심 수정 파일 목록

| 파일 | 수정 내용 | 중요도 |
|------|----------|--------|
| `consensus/clique/clique.go` | **Finalize 함수 - 균등 분배 보상 로직** | ⭐⭐⭐ 최핵심 |
| `params/config.go` | 체인 ID 7777, Clique Period 5 | ⭐⭐⭐ |
| `params/denomination.go` | Ether → TTL 단위 변경 | ⭐⭐ |
| `params/protocol_params.go` | 블록 보상 상수 정의 | ⭐⭐⭐ |
| `cmd/geth/main.go` | CLI 배너, 네트워크 이름 | ⭐ |
| `cmd/geth/usage.go` | 도움말 텍스트 | ⭐ |
| `core/genesis.go` | 네트워크 이름 | ⭐ |
| `internal/ethapi/api.go` | RPC 응답 시 단위 표시 (선택) | ⭐ |

### 3. 핵심 코드 변경 상세

#### 3-1. 보상 분배 로직 (consensus/clique/clique.go)

`Finalize` 함수를 찾아서 수정합니다. 기존에는 블록 생성자(`header.Coinbase`)에게만 보상을 지급하지만,
TTL Coin에서는 **Clique snapshot의 전체 signers에게 균등 분배**합니다.

```go
func (c *Clique) Finalize(chain consensus.ChainHeaderReader, header *types.Header, state *state.StateDB, body *types.Body) {
    // TTL Coin: 전체 허가 채굴자에게 균등 분배
    snap, err := c.snapshot(chain, header.Number.Uint64()-1, header.ParentHash, nil)
    if err != nil {
        // snapshot을 못 가져오면 블록 생성자에게만 지급 (폴백)
        state.AddBalance(header.Coinbase, TTLBlockReward, tracing.BalanceIncreaseRewardMineBlock)
        return
    }

    signers := snap.signers()

    if len(signers) == 0 {
        return
    }

    // 총 보상: 7,777 TTL (7777 * 10^18 Wei)
    totalReward := new(big.Int).Set(TTLBlockReward)

    // TODO: 맥스캡 체크
    // 현재 총 발행량을 추적하여 MaxTotalSupply(7,777억 TTL)를 초과하면 보상을 0으로 설정
    // 구현 방법: State에 특수 주소의 잔고로 총 발행량 추적, 또는 블록 넘버 기반 계산

    // 1인당 보상 계산
    perSigner := new(big.Int).Div(totalReward, big.NewInt(int64(len(signers))))

    // 나머지 처리 (정수 나눗셈으로 인한 소수점 이하 버림)
    remainder := new(big.Int).Mod(totalReward, big.NewInt(int64(len(signers))))

    // 전체 signer에게 균등 분배
    for _, signer := range signers {
        state.AddBalance(signer, perSigner, tracing.BalanceIncreaseRewardMineBlock)
    }

    // 나머지는 블록 생성자에게 추가 지급 (Wei 단위 미미한 차이)
    if remainder.Sign() > 0 {
        state.AddBalance(header.Coinbase, remainder, tracing.BalanceIncreaseRewardMineBlock)
    }
}
```

#### 3-2. 보상 상수 정의 (params/protocol_params.go 또는 새 파일)

```go
var (
    // TTL Coin: 7,777 TTL per block = 7777 * 10^18 Wei
    TTLBlockReward = new(big.Int).Mul(big.NewInt(7777), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))

    // TTL Coin: Max total supply = 777,700,000,000 TTL = 777700000000 * 10^18 Wei
    TTLMaxTotalSupply = new(big.Int).Mul(big.NewInt(777700000000), new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil))
)
```

#### 3-3. 체인 설정 (params/config.go)

```go
// TTL Coin Chain Config
TTLChainConfig = &ChainConfig{
    ChainID:                       big.NewInt(7777),
    HomesteadBlock:                big.NewInt(0),
    EIP150Block:                   big.NewInt(0),
    EIP155Block:                   big.NewInt(0),
    EIP158Block:                   big.NewInt(0),
    ByzantiumBlock:                big.NewInt(0),
    ConstantinopleBlock:           big.NewInt(0),
    PetersburgBlock:               big.NewInt(0),
    IstanbulBlock:                 big.NewInt(0),
    BerlinBlock:                   big.NewInt(0),
    LondonBlock:                   big.NewInt(0),
    Clique: &CliqueConfig{
        Period: 5,     // 5초 블록 타임
        Epoch:  30000, // 체크포인트 간격
    },
}
```

#### 3-4. 단위 변경 (params/denomination.go)

```go
const (
    Wei   = 1
    GWei  = 1e9
    TTL   = 1e18  // 기존 Ether → TTL로 명칭 변경
)
```

#### 3-5. 맥스캡 로직 (중요)

블록 넘버 기반으로 총 발행량을 계산하여 맥스캡을 체크합니다:

```go
// 블록 넘버 기반 총 발행량 계산
// totalMinted = blockNumber * TTLBlockReward (균등 분배이므로 총량은 동일)
func calcTotalMinted(blockNumber *big.Int) *big.Int {
    return new(big.Int).Mul(blockNumber, TTLBlockReward)
}

// Finalize 내에서 맥스캡 체크
totalMinted := calcTotalMinted(header.Number)
if totalMinted.Cmp(TTLMaxTotalSupply) >= 0 {
    // 맥스캡 도달 → 보상 없음
    return
}

// 남은 발행 가능량이 1블록 보상보다 적으면 남은 만큼만 분배
remaining := new(big.Int).Sub(TTLMaxTotalSupply, totalMinted)
if remaining.Cmp(TTLBlockReward) < 0 {
    totalReward = remaining
}
```

---

## 제네시스 파일 (genesis.json)

```json
{
  "config": {
    "chainId": 7777,
    "homesteadBlock": 0,
    "eip150Block": 0,
    "eip155Block": 0,
    "eip158Block": 0,
    "byzantiumBlock": 0,
    "constantinopleBlock": 0,
    "petersburgBlock": 0,
    "istanbulBlock": 0,
    "berlinBlock": 0,
    "londonBlock": 0,
    "clique": {
      "period": 5,
      "epoch": 30000
    }
  },
  "difficulty": "1",
  "gasLimit": "30000000",
  "extradata": "0x0000000000000000000000000000000000000000000000000000000000000000<SIGNER_ADDRESS_WITHOUT_0x>0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "alloc": {}
}
```

### extradata 구조 (Clique PoA)
- 32바이트 vanity (0x00...00)
- 20바이트 × N개의 초기 signer 주소 (0x 제외)
- 65바이트 seal (0x00...00)

### 초기 signer 추가 예시 (주소가 0xABCD...1234인 경우)
```
0x0000000000000000000000000000000000000000000000000000000000000000ABCD...12340000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

---

## 빌드 및 실행

### 빌드 환경

```bash
# Go 1.22 설치
wget https://go.dev/dl/go1.22.12.linux-amd64.tar.gz
rm -rf /usr/local/go
tar -C /usr/local -xzf go1.22.12.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin

# 빌드 도구
apt install -y build-essential git make
```

### 빌드

```bash
cd ttlcoin
make geth
```

바이너리 위치: `./build/bin/geth`

### 노드 초기화 및 실행

```bash
# 데이터 디렉토리
mkdir -p /root/.ttlcoin

# 계정 생성
./build/bin/geth --datadir /root/.ttlcoin account new

# 비밀번호 파일 생성
echo "YOUR_PASSWORD" > /root/.ttlcoin/password.txt
chmod 600 /root/.ttlcoin/password.txt

# genesis.json의 extradata에 위에서 생성한 계정 주소를 signer로 추가한 후:

# 제네시스 초기화
./build/bin/geth --datadir /root/.ttlcoin init genesis.json

# 노드 실행
./build/bin/geth \
  --datadir /root/.ttlcoin \
  --networkid 7777 \
  --port 30303 \
  --http \
  --http.addr "0.0.0.0" \
  --http.port 8545 \
  --http.api "eth,net,web3,personal,admin,clique,miner,txpool" \
  --http.corsdomain "*" \
  --allow-insecure-unlock \
  --mine \
  --miner.etherbase "YOUR_SIGNER_ADDRESS" \
  --unlock "YOUR_SIGNER_ADDRESS" \
  --password /root/.ttlcoin/password.txt \
  --verbosity 3 \
  console
```

---

## 서버 환경

| 항목 | 값 |
|------|-----|
| 서버 | ServaRICA 전용서버 |
| 하이퍼바이저 | Proxmox VE 9.1.7 |
| 총 RAM | 128GB |
| 스토리지 | NVMe 3.6TB |
| OS (VM) | Ubuntu 22.04 LTS Server |

### VM 구성

| VM | IP | 용도 | RAM | vCPU |
|----|-----|------|-----|------|
| vm-main | 207.90.195.147 | TTL 메인노드 + 지갑API + 어드민 | 8GB | 8 |
| vm-backup | 207.90.195.148 | TTL 백업노드 + 지갑API + 익스플로러 | 8GB | 8 |
| vm-ubuntu-gui | 207.90.195.149 | Electron 지갑 GUI 테스트 | 12GB | 4 |
| vm-web | 207.90.195.150 | 웹서비스 | 8GB | 4 |
| vm-dev | 207.90.195.151 | 개발/테스트 (Claude Code 실행) | 4GB | 4 |

---

## 작업 순서

1. ✅ 서버 세팅 (Proxmox + VM 생성 + 네트워크)
2. ⬜ Go 1.22 + 빌드 도구 설치 (vm-dev)
3. ⬜ Geth v1.14.12 클론
4. ⬜ 소스 코드 수정 (위 가이드 참조)
   - consensus/clique/clique.go (균등 분배 보상)
   - params/config.go (체인 ID 7777, Period 5)
   - params/denomination.go (ETH → TTL)
   - params/protocol_params.go (보상 상수)
   - 맥스캡 로직
   - CLI 배너/이름 변경
5. ⬜ 빌드 (`make geth`)
6. ⬜ 계정 생성 + genesis.json 생성
7. ⬜ 메인 노드 초기화 및 실행 (vm-main)
8. ⬜ 백업 노드 초기화 및 연결 (vm-backup)
9. ⬜ 블록 익스플로러 연동 (vm-backup)
10. ⬜ Electron 지갑 리브랜딩 (vm-ubuntu-gui / vm-win11)
11. ⬜ 어드민 패널 연동

---

## 주의사항

- **v1.14.x는 v1.13.x와 내부 API 구조가 다릅니다.** 특히 consensus 관련 코드가 리팩토링되었으므로, Finalize 함수의 시그니처와 파라미터를 확인 후 수정하세요.
- **v1.14.0부터 State DB 기본값이 Path DB로 변경**되어 자동 프루닝이 지원됩니다. 5초 블록으로 데이터가 빠르게 쌓이므로 이 기능이 중요합니다.
- **state.AddBalance 함수의 시그니처가 v1.14에서 변경**되었습니다. 세 번째 인자로 `tracing.BalanceChangeReason`이 필요합니다.
- **Clique snapshot의 signers() 메서드**를 사용하여 현재 허가된 채굴자 목록을 가져옵니다.
- **genesis.json의 extradata에 최소 1개의 signer 주소**가 포함되어야 PoA 체인이 시작됩니다.
- **프라이빗 PoA 체인이므로 메인넷 관련 하드포크 코드(Cancun, Prague 등)는 비활성화** 상태로 두면 됩니다.

---

## Claude Code 사용 시 프롬프트 예시

```
위 TTL_COIN_SPEC.md 파일을 읽고, go-ethereum v1.14.12를 포크하여 TTL Coin을 구현해줘.

작업 순서:
1. Geth v1.14.12 클론
2. 소스 코드에서 수정할 파일들을 찾아서 스펙대로 수정
3. 특히 consensus/clique/clique.go의 Finalize 함수에서 균등 분배 보상 로직 구현
4. 맥스캡 체크 로직 구현
5. params 수정 (체인 ID, 블록 타임, 단위명)
6. 빌드 테스트
```
