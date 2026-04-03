package eth

import (
	"crypto/ecdsa"
	"math/big"
	"sync"
	"time"

	"errors"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/consensus/clique"
	"github.com/ethereum/go-ethereum/consensus/misc/eip1559"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/txpool"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/log"
)

// CliqueMiner runs a PoA mining loop for standalone Clique consensus.
type CliqueMiner struct {
	eth    *Ethereum
	engine *clique.Clique
	signer common.Address
	stopCh chan struct{}
	wg     sync.WaitGroup
}

// NewCliqueMinerWithKey creates a Clique PoA miner with an explicit private key.
func NewCliqueMinerWithKey(eth *Ethereum, signer common.Address, key *ecdsa.PrivateKey) (*CliqueMiner, error) {
	engine, ok := eth.Engine().(*clique.Clique)
	if !ok {
		return nil, nil
	}

	signFn := func(addr common.Address, mimeType string, message []byte) ([]byte, error) {
		return crypto.Sign(message, key)
	}
	engine.Authorize(signer, signFn)

	return &CliqueMiner{
		eth:    eth,
		engine: engine,
		signer: signer,
		stopCh: make(chan struct{}),
	}, nil
}

// Start begins the mining loop.
func (cm *CliqueMiner) Start() error {
	log.Info("Starting Clique PoA miner", "signer", cm.signer)
	cm.wg.Add(1)
	go cm.loop()
	return nil
}

// Stop halts the mining loop.
func (cm *CliqueMiner) Stop() error {
	close(cm.stopCh)
	cm.wg.Wait()
	log.Info("Clique PoA miner stopped")
	return nil
}

func (cm *CliqueMiner) loop() {
	defer cm.wg.Done()

	chain := cm.eth.BlockChain()
	period := time.Duration(cm.engine.Period()) * time.Second
	if period == 0 {
		period = 5 * time.Second
	}

	// Subscribe to chain head events
	chainHeadCh := make(chan core.ChainHeadEvent, 10)
	sub := chain.SubscribeChainHeadEvent(chainHeadCh)
	defer sub.Unsubscribe()

	// Initial seal attempt
	cm.tryMineBlock(chain)

	for {
		select {
		case <-cm.stopCh:
			return
		case <-chainHeadCh:
			time.Sleep(100 * time.Millisecond)
			cm.tryMineBlock(chain)
		case <-time.After(period + time.Second):
			cm.tryMineBlock(chain)
		}
	}
}

func (cm *CliqueMiner) tryMineBlock(chain *core.BlockChain) {
	parent := chain.CurrentBlock()
	if parent == nil {
		return
	}

	num := parent.Number.Uint64() + 1
	parentHeader := chain.GetHeaderByHash(parent.Hash())
	if parentHeader == nil {
		return
	}
	header := &types.Header{
		ParentHash: parent.Hash(),
		Number:     new(big.Int).SetUint64(num),
		GasLimit:   parent.GasLimit,
		Time:       parent.Time + cm.engine.Period(),
		Extra:      make([]byte, 0),
	}
	// Set BaseFee for London (EIP-1559) compatible blocks
	if chain.Config().IsLondon(header.Number) {
		header.BaseFee = eip1559.CalcBaseFee(chain.Config(), parentHeader)
	}

	// Ensure we don't create blocks in the future
	now := uint64(time.Now().Unix())
	if header.Time > now {
		delay := time.Duration(header.Time-now) * time.Second
		select {
		case <-time.After(delay):
		case <-cm.stopCh:
			return
		}
	}

	// Prepare the header (sets difficulty, extra data, coinbase, etc.)
	if err := cm.engine.Prepare(chain, header); err != nil {
		log.Debug("Failed to prepare block header", "err", err)
		return
	}

	// Create the block
	block, statedb, err := cm.createBlock(chain, header)
	if err != nil {
		log.Debug("Failed to create block", "err", err)
		return
	}
	_ = statedb

	// Seal the block
	results := make(chan *types.Block, 1)
	stop := make(chan struct{})
	if err := cm.engine.Seal(chain, block, results, stop); err != nil {
		log.Debug("Failed to seal block", "err", err)
		return
	}

	select {
	case sealedBlock := <-results:
		if sealedBlock == nil {
			return
		}
		log.Info("Successfully sealed new block", "number", sealedBlock.Number(), "hash", sealedBlock.Hash())
		if _, err := chain.InsertChain([]*types.Block{sealedBlock}); err != nil {
			log.Error("Failed to insert sealed block", "err", err)
		}
	case <-cm.stopCh:
		close(stop)
		return
	case <-time.After(15 * time.Second):
		close(stop)
		log.Debug("Seal timeout")
	}
}

func (cm *CliqueMiner) createBlock(chain *core.BlockChain, header *types.Header) (*types.Block, *state.StateDB, error) {
	parentHeader := chain.GetHeaderByHash(header.ParentHash)
	if parentHeader == nil {
		return nil, nil, errors.New("unknown ancestor")
	}

	statedb, err := chain.StateAt(parentHeader.Root)
	if err != nil {
		return nil, nil, err
	}

	// Include pending transactions
	body := &types.Body{}
	var receipts []*types.Receipt
	gasUsed := uint64(0)

	pending := cm.eth.TxPool().Pending(txpool.PendingFilter{})
	if len(pending) > 0 {
		var included []*types.Transaction
		gasPool := new(core.GasPool).AddGas(header.GasLimit)
		var vmCfg vm.Config

		for _, txList := range pending {
			for _, lazyTx := range txList {
				tx := lazyTx.Resolve()
				if tx == nil {
					continue
				}
				if gasUsed+tx.Gas() > header.GasLimit {
					continue
				}
				snap := statedb.Snapshot()
				receipt, err := core.ApplyTransaction(chain.Config(), chain, &header.Coinbase, gasPool, statedb, header, tx, &gasUsed, vmCfg)
				if err != nil {
					statedb.RevertToSnapshot(snap)
					continue
				}
				receipts = append(receipts, receipt)
				included = append(included, tx)
			}
		}
		body.Transactions = included
		header.GasUsed = gasUsed
	}

	// Finalize and assemble
	block, err := cm.engine.FinalizeAndAssemble(chain, header, statedb, body, receipts)
	if err != nil {
		return nil, nil, err
	}
	return block, statedb, nil
}
