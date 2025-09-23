# Changelog

All notable changes to this project will be documented in this file.

## v2

- Bumped all `contracts` module `version` constants to `2` and updated related checks and documentation.
- Flattened repository layout to top-level `contracts/`, `scripts/`, and `test/` directories to simplify tooling.
- `RandaoCoordinator.random` now mixes the XORed seed with `block.prevrandao` for block-dependent entropy.

## v1

- Updated Solidity compiler to version 0.8.21 across contracts, configuration, and docs.
- Updated dependencies: Node.js 22.x LTS, Hardhat 2.26.1, @nomicfoundation/hardhat-toolbox 6.1.0, and OpenZeppelin Contracts 5.4.0.
- Introduced AGIJobManagerV1 contract and updated deployment script.
- Expanded README with security notice and toolchain verification steps.
- Standardised on 18‑decimal `$AGIALPHA` token at `0xA61a3B3a130a9c20768EEBF97E21515A6046a1fA`; token swapping instructions marked as legacy.
- Removed legacy `MockERC20SixDecimals` test token following 18‑decimal migration.

## v0

- Initial release of AGIJobManager with core job management, reputation, and NFT marketplace features.
