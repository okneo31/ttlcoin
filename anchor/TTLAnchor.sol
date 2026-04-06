// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title TTL Coin Chain Anchor
/// @notice Stores TTL chain block hashes on Polygon for integrity verification
contract TTLAnchor {
    address public owner;

    struct Checkpoint {
        uint256 ttlBlockNumber;
        bytes32 ttlBlockHash;
        bytes32 ttlStateRoot;
        uint256 timestamp;
    }

    // Latest checkpoint
    Checkpoint public latest;

    // All checkpoints: ttlBlockNumber => Checkpoint
    mapping(uint256 => Checkpoint) public checkpoints;

    // List of anchored block numbers for enumeration
    uint256[] public anchoredBlocks;

    event Anchored(
        uint256 indexed ttlBlockNumber,
        bytes32 ttlBlockHash,
        bytes32 ttlStateRoot,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Anchor a TTL chain block hash
    function anchor(
        uint256 ttlBlockNumber,
        bytes32 ttlBlockHash,
        bytes32 ttlStateRoot
    ) external onlyOwner {
        require(ttlBlockNumber > latest.ttlBlockNumber, "block must be newer");

        Checkpoint memory cp = Checkpoint({
            ttlBlockNumber: ttlBlockNumber,
            ttlBlockHash: ttlBlockHash,
            ttlStateRoot: ttlStateRoot,
            timestamp: block.timestamp
        });

        checkpoints[ttlBlockNumber] = cp;
        latest = cp;
        anchoredBlocks.push(ttlBlockNumber);

        emit Anchored(ttlBlockNumber, ttlBlockHash, ttlStateRoot, block.timestamp);
    }

    /// @notice Verify a TTL block hash
    function verify(uint256 ttlBlockNumber) external view returns (
        bytes32 blockHash,
        bytes32 stateRoot,
        uint256 anchoredAt
    ) {
        Checkpoint memory cp = checkpoints[ttlBlockNumber];
        require(cp.timestamp > 0, "not anchored");
        return (cp.ttlBlockHash, cp.ttlStateRoot, cp.timestamp);
    }

    /// @notice Total number of anchored checkpoints
    function totalCheckpoints() external view returns (uint256) {
        return anchoredBlocks.length;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}
