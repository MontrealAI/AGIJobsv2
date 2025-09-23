// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import {CommitRevealHarness} from "../../contracts/gas/CommitRevealHarness.sol";

contract CommitRevealGas is Test {
    CommitRevealHarness internal commitReveal;

    uint256 internal constant JOB_ID = 1;
    bool internal constant APPROVED = true;
    bytes32 internal constant SPEC_HASH = keccak256("spec");
    bytes32 internal constant SALT = keccak256("salt");
    bytes32 internal constant COMMIT_HASH = keccak256(
        abi.encodePacked(JOB_ID, uint256(0), APPROVED, SALT, SPEC_HASH)
    );

    function setUp() public {
        vm.pauseGasMetering();
        commitReveal = new CommitRevealHarness();
        vm.resumeGasMetering();
    }

    function testCommitGas() public {
        commitReveal.commit(JOB_ID, COMMIT_HASH);
    }

    function testRevealGas() public {
        vm.pauseGasMetering();
        commitReveal.commit(JOB_ID, COMMIT_HASH);
        vm.resumeGasMetering();

        bool approved = commitReveal.reveal(JOB_ID, APPROVED, SALT, SPEC_HASH);

        assertTrue(approved, "approval mismatch");
        assertTrue(commitReveal.revealed(JOB_ID, address(this)), "reveal not recorded");
        assertEq(commitReveal.nonces(JOB_ID), 1, "nonce not incremented");
    }
}
