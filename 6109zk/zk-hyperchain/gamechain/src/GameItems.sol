// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GameItems
/// @notice ERC-1155-style on-chain item minting for the gaming appchain.
///         Items have rarity tiers; only the game master can mint.
contract GameItems {
    // ─── Types ───────────────────────────────────────────────────────────────

    enum Rarity { Common, Rare, Epic, Legendary }

    struct ItemType {
        string  name;
        Rarity  rarity;
        uint256 maxSupply;   // 0 = unlimited
        uint256 totalMinted;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    address public gameMaster;

    mapping(uint256 => ItemType)                      public itemTypes;
    mapping(address => mapping(uint256 => uint256))   public balances;
    mapping(uint256 => bool)                          public itemExists;

    uint256 public nextItemTypeId;

    // ─── Events ───────────────────────────────────────────────────────────────

    event ItemTypeCreated(uint256 indexed itemTypeId, string name, Rarity rarity, uint256 maxSupply);
    event ItemMinted(address indexed to, uint256 indexed itemTypeId, uint256 amount);
    event ItemBurned(address indexed from, uint256 indexed itemTypeId, uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotGameMaster();
    error ItemTypeNotFound(uint256 itemTypeId);
    error MaxSupplyReached(uint256 itemTypeId);
    error InsufficientBalance(address account, uint256 itemTypeId);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        gameMaster = msg.sender;
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyGameMaster() {
        if (msg.sender != gameMaster) revert NotGameMaster();
        _;
    }

    // ─── External ─────────────────────────────────────────────────────────────

    /// @notice Register a new item type. Returns its ID.
    function createItemType(
        string calldata name,
        Rarity rarity,
        uint256 maxSupply
    ) external onlyGameMaster returns (uint256 itemTypeId) {
        itemTypeId = nextItemTypeId++;
        itemTypes[itemTypeId] = ItemType(name, rarity, maxSupply, 0);
        itemExists[itemTypeId] = true;
        emit ItemTypeCreated(itemTypeId, name, rarity, maxSupply);
    }

    /// @notice Mint items to a player. Respects maxSupply (0 = unlimited).
    function mint(address to, uint256 itemTypeId, uint256 amount) external onlyGameMaster {
        if (!itemExists[itemTypeId]) revert ItemTypeNotFound(itemTypeId);
        ItemType storage item = itemTypes[itemTypeId];
        if (item.maxSupply > 0 && item.totalMinted + amount > item.maxSupply) {
            revert MaxSupplyReached(itemTypeId);
        }
        item.totalMinted += amount;
        balances[to][itemTypeId] += amount;
        emit ItemMinted(to, itemTypeId, amount);
    }

    /// @notice Burn items from caller's balance.
    function burn(uint256 itemTypeId, uint256 amount) external {
        if (balances[msg.sender][itemTypeId] < amount) {
            revert InsufficientBalance(msg.sender, itemTypeId);
        }
        balances[msg.sender][itemTypeId] -= amount;
        itemTypes[itemTypeId].totalMinted -= amount;
        emit ItemBurned(msg.sender, itemTypeId, amount);
    }

    /// @notice Batch balance query.
    function balanceOfBatch(
        address[] calldata accounts,
        uint256[] calldata ids
    ) external view returns (uint256[] memory) {
        require(accounts.length == ids.length, "length mismatch");
        uint256[] memory result = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            result[i] = balances[accounts[i]][ids[i]];
        }
        return result;
    }

    /// @notice Get item type metadata.
    function getItemType(uint256 itemTypeId) external view returns (ItemType memory) {
        if (!itemExists[itemTypeId]) revert ItemTypeNotFound(itemTypeId);
        return itemTypes[itemTypeId];
    }
}
