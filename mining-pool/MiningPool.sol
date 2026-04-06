// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title TTL Coin Mining Pool
/// @notice Delegated mining - distributes block rewards to participants
contract MiningPool {
    address public owner;

    struct Miner {
        bool active;
        uint256 shares;       // Weight for reward distribution
        uint256 totalEarned;
        uint256 joinedAt;
    }

    mapping(address => Miner) public miners;
    address[] public minerList;
    uint256 public totalShares;
    uint256 public totalDistributed;
    uint256 public minDeposit;

    event MinerJoined(address indexed miner, uint256 shares);
    event MinerLeft(address indexed miner);
    event RewardsDistributed(uint256 amount, uint256 minerCount);
    event RewardPaid(address indexed miner, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(uint256 _minDeposit) {
        owner = msg.sender;
        minDeposit = _minDeposit;
    }

    /// @notice Join the mining pool
    function join() external payable {
        require(!miners[msg.sender].active, "already joined");
        require(msg.value >= minDeposit, "below min deposit");

        uint256 shares = msg.value == 0 ? 1 : msg.value / 1 ether;
        if (shares == 0) shares = 1;

        miners[msg.sender] = Miner({
            active: true,
            shares: shares,
            totalEarned: 0,
            joinedAt: block.timestamp
        });
        minerList.push(msg.sender);
        totalShares += shares;

        emit MinerJoined(msg.sender, shares);
    }

    /// @notice Admin adds a miner without deposit (for approved miners)
    function addMiner(address miner, uint256 shares) external onlyOwner {
        require(!miners[miner].active, "already joined");
        if (shares == 0) shares = 1;

        miners[miner] = Miner({
            active: true,
            shares: shares,
            totalEarned: 0,
            joinedAt: block.timestamp
        });
        minerList.push(miner);
        totalShares += shares;

        emit MinerJoined(miner, shares);
    }

    /// @notice Leave the mining pool
    function leave() external {
        require(miners[msg.sender].active, "not a miner");
        miners[msg.sender].active = false;
        totalShares -= miners[msg.sender].shares;
        emit MinerLeft(msg.sender);
    }

    /// @notice Remove a miner (admin only)
    function removeMiner(address miner) external onlyOwner {
        require(miners[miner].active, "not active");
        miners[miner].active = false;
        totalShares -= miners[miner].shares;
        emit MinerLeft(miner);
    }

    /// @notice Distribute rewards to all active miners
    /// Called by the distribution script with block rewards
    function distribute() external payable onlyOwner {
        require(msg.value > 0, "no rewards");
        require(totalShares > 0, "no miners");

        uint256 remaining = msg.value;

        for (uint256 i = 0; i < minerList.length; i++) {
            address addr = minerList[i];
            if (!miners[addr].active) continue;

            uint256 share = (msg.value * miners[addr].shares) / totalShares;
            if (share == 0) continue;

            miners[addr].totalEarned += share;
            remaining -= share;

            (bool ok, ) = payable(addr).call{value: share}("");
            if (ok) {
                emit RewardPaid(addr, share);
            } else {
                remaining += share;
            }
        }

        // Send dust back to owner
        if (remaining > 0) {
            payable(owner).call{value: remaining}("");
        }

        totalDistributed += msg.value;
        emit RewardsDistributed(msg.value, activeMinerCount());
    }

    /// @notice Get active miner count
    function activeMinerCount() public view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < minerList.length; i++) {
            if (miners[minerList[i]].active) count++;
        }
        return count;
    }

    /// @notice Get all miners info
    function getMinerCount() external view returns (uint256) {
        return minerList.length;
    }

    /// @notice Update min deposit
    function setMinDeposit(uint256 _minDeposit) external onlyOwner {
        minDeposit = _minDeposit;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    receive() external payable {}
}
