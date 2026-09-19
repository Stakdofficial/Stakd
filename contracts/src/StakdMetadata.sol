// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface ILeveredCoins {
    struct Coin {
        address token;
        address treasury;
        bytes32 poolId;
        address creator;
        uint64 createdAt;
    }

    function coinIdOf(address token) external view returns (uint256);
    function coin(uint256 id) external view returns (Coin memory);
}

/// @title StakdMetadata
/// @notice Optional off-chain-ish profile for a Stakd coin: logo, description and social links.
///         Kept out of LeveredFactory so the launch path stays unchanged — only the coin's creator
///         (or the Stakd owner, for moderation) may write, and every field is optional.
contract StakdMetadata is Ownable {
    struct Meta {
        string image; // logo: a data: URI, or an https:// / ipfs:// URL
        string description; // optional blurb
        string telegram;
        string x;
        string website;
    }

    /// @dev Large enough for a small inline image (data:image/webp;base64,…) resized in the browser,
    ///      so a coin's logo lives on-chain and cannot rot when some host disappears.
    uint256 public constant MAX_IMAGE = 16_000;
    uint256 public constant MAX_DESCRIPTION = 600;
    uint256 public constant MAX_LINK = 200;

    ILeveredCoins public immutable factory;

    mapping(address token => Meta) private _meta;
    mapping(address token => bool) public frozen; // owner can freeze abusive metadata

    event MetadataSet(address indexed token, address indexed by);
    event MetadataFrozen(address indexed token, bool frozen);

    error NotLaunchedOnStakd();
    error NotCreator();
    error TooLong();
    error Frozen();

    constructor(ILeveredCoins factory_, address owner_) Ownable(owner_) {
        factory = factory_;
    }

    /// @notice The address allowed to edit this token's profile.
    function creatorOf(address token) public view returns (address) {
        uint256 id = factory.coinIdOf(token);
        if (id == 0) revert NotLaunchedOnStakd();
        return factory.coin(id - 1).creator;
    }

    function metadata(address token) external view returns (Meta memory) {
        return _meta[token];
    }

    /// @notice Set (or clear) the coin's profile. Every field may be left empty.
    function setMetadata(address token, Meta calldata m) external {
        if (frozen[token]) revert Frozen();
        if (msg.sender != creatorOf(token) && msg.sender != owner()) revert NotCreator();
        if (bytes(m.image).length > MAX_IMAGE || bytes(m.description).length > MAX_DESCRIPTION) revert TooLong();
        if (bytes(m.telegram).length > MAX_LINK || bytes(m.x).length > MAX_LINK || bytes(m.website).length > MAX_LINK) {
            revert TooLong();
        }
        _meta[token] = m;
        emit MetadataSet(token, msg.sender);
    }

    /// @notice Moderation: stop further edits (and let the front end hide the profile).
    function setFrozen(address token, bool value) external onlyOwner {
        frozen[token] = value;
        emit MetadataFrozen(token, value);
    }
}
