// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {CommitRevealMock} from "../CommitRevealMock.sol";

/// @title CommitRevealHarness
/// @notice Thin wrapper that exposes the CommitRevealMock for Foundry gas benchmarks.
contract CommitRevealHarness is CommitRevealMock {}
