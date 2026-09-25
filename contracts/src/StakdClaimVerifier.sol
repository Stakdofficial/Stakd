// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title StakdClaimVerifier
/// @notice Checks the proof that someone logged in as a given social account. Every coin's treasury shares this
///         one copy: the treasury's creation code is embedded in the factory, so keeping signature checking out
///         of it is what keeps the factory under the contract size limit.
contract StakdClaimVerifier {
    /// @return true when `proof` was signed by `signer` for exactly this claim, on this chain.
    function isValid(
        address signer,
        address treasury,
        string calldata handle,
        bytes32 subject,
        address payout,
        uint256 deadline,
        bytes calldata proof
    ) external view returns (bool) {
        if (signer == address(0)) return false;
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(block.chainid, treasury, handle, subject, payout, deadline))
        );
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, proof);
        return err == ECDSA.RecoverError.NoError && recovered == signer;
    }
}
