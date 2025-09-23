// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

contract Migrations {
    address public owner = msg.sender;
    uint256 public lastCompletedMigration;

    modifier restricted() {
        require(msg.sender == owner, "!owner");
        _;
    }

    function setCompleted(uint256 completed) external restricted {
        lastCompletedMigration = completed;
    }
}
