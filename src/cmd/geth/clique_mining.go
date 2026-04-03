package main

import (
	"crypto/ecdsa"
	"os"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/cmd/utils"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/consensus/clique"
	"github.com/ethereum/go-ethereum/eth"
	"github.com/ethereum/go-ethereum/log"
	"github.com/ethereum/go-ethereum/node"
	"github.com/urfave/cli/v2"
)

// startCliqueMining starts the Clique PoA mining loop if applicable.
func startCliqueMining(ctx *cli.Context, stack *node.Node, ethService *eth.Ethereum) *eth.CliqueMiner {
	if !ctx.Bool(utils.MiningEnabledFlag.Name) {
		return nil
	}
	if ethService == nil {
		return nil
	}

	// Check if the engine is standalone Clique (not wrapped in beacon)
	if _, ok := ethService.Engine().(*clique.Clique); !ok {
		return nil
	}

	// Get signer address from --miner.etherbase
	etherbase := ctx.String(utils.MinerEtherbaseFlag.Name)
	if etherbase == "" {
		log.Warn("Clique mining requires --miner.etherbase to be set")
		return nil
	}
	signer := common.HexToAddress(etherbase)

	// Load the private key from the keystore
	key := loadSignerKey(ctx, stack, signer)
	if key == nil {
		log.Error("Failed to load signer key for Clique mining", "signer", signer)
		return nil
	}

	cm, err := eth.NewCliqueMinerWithKey(ethService, signer, key)
	if err != nil {
		log.Error("Failed to create Clique miner", "err", err)
		return nil
	}
	if cm == nil {
		return nil
	}

	if err := cm.Start(); err != nil {
		log.Error("Failed to start Clique miner", "err", err)
		return nil
	}
	return cm
}

// loadSignerKey loads the private key for the given address from the keystore.
func loadSignerKey(ctx *cli.Context, stack *node.Node, signer common.Address) *ecdsa.PrivateKey {
	// Read password
	password := ""
	if ctx.IsSet(utils.PasswordFileFlag.Name) {
		data, err := os.ReadFile(ctx.String(utils.PasswordFileFlag.Name))
		if err != nil {
			log.Error("Failed to read password file", "err", err)
			return nil
		}
		password = strings.TrimSpace(string(data))
	}

	// Find the keystore backend and unlock the account
	am := stack.AccountManager()
	for _, backend := range am.Backends(keystore.KeyStoreType) {
		ks := backend.(*keystore.KeyStore)
		for _, account := range ks.Accounts() {
			if account.Address == signer {
				if err := ks.Unlock(account, password); err != nil {
					log.Error("Failed to unlock signer account", "address", signer, "err", err)
					return nil
				}
				keyJSON, err := ks.Export(account, password, password)
				if err != nil {
					log.Error("Failed to export signer key", "err", err)
					return nil
				}
				key, err := keystore.DecryptKey(keyJSON, password)
				if err != nil {
					log.Error("Failed to decrypt signer key", "err", err)
					return nil
				}
				return key.PrivateKey
			}
		}
	}

	log.Error("Signer account not found in keystore", "address", signer)
	return nil
}
