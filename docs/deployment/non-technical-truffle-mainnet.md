# Non-Technical Production Deployment on Ethereum Mainnet (Truffle CLI)

This guide walks a non-technical operator through deploying the complete AGIJobs v2 stack to Ethereum mainnet using only the commands provided in this repository. No Solidity knowledge is required—every step is scripted and validated so you can focus on configuration and record keeping.

- **Audience:** Business operators, operations managers, programme coordinators.
- **Goal:** Deploy all AGIJobs v2 contracts, verify them, wire modules, and tune governance parameters using Truffle.
- **Estimated time:** 45–60 minutes including verification and record keeping.

> ⚠️ **High-stakes reminder:** Mainnet deployments are irreversible. Triple-check addresses, configuration files, and environment variables before sending any transaction.

## 0. Prerequisites Checklist

| Requirement               | Notes                                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| Node.js 20.x + npm 10+    | `nvm use` (repository ships `.nvmrc`).                                   |
| Git                       | Clone or download the repository.                                        |
| Ethereum mainnet RPC URL  | Infura, Alchemy, QuickNode, etc.                                         |
| Deploy key (private key)  | The account that will broadcast migrations. Fund it with sufficient ETH. |
| Governance address        | A multisig or timelock that will own the system post-deployment.         |
| `$AGIALPHA` token address | Fixed at `config/agialpha.json` (already committed).                     |
| Etherscan API key         | Enables automated verification.                                          |
| ENS details               | Agent/validator roots in `deployment-config/mainnet.json`.               |

**Documents to print / save:**

- `deployment-config/mainnet.json`
- `config/agialpha.json`
- `config/governance-update.example.json`
- Blank log sheet for recording contract addresses and transaction hashes.

## 1. Environment Setup

```bash
# 1. Clone repository and enter directory
git clone https://github.com/MontrealAI/AGIJobsv2.git
cd AGIJobsv2

# 2. Install Node.js version declared in .nvmrc
nvm use

# 3. Install dependencies
npm install
```

Copy `.env.example` to `.env` and fill the values:

```bash
cp .env.example .env
```

Update `.env` with production values:

```env
MAINNET_RPC_URL=https://mainnet.infura.io/v3/<project>
MAINNET_PRIVATE_KEY=0x<private-key-without-spaces>
GOVERNANCE_ADDRESS=0xYourMultisig
ETHERSCAN_API_KEY=<etherscan-api-key>
```

> ✅ **Safety tip:** use a dedicated deployer key with limited funds; move contract ownership to the governance multisig immediately after deployment.

## 2. Review Canonical Token Configuration

The `$AGIALPHA` metadata lives in `config/agialpha.json`. Do **not** edit unless the token contract changes. To validate configuration and regenerate Solidity constants run:

```bash
npm run compile
```

The command halts if token metadata is inconsistent and regenerates `contracts/Constants.sol` automatically.

## 3. Fill Mainnet Deployment Configuration

Edit `deployment-config/mainnet.json` with production parameters:

- `governance.initial` — temporary owner during deployment (usually the deployer address).
- `governance.final` — final governance multisig or timelock.
- `stakeManager.minStakeTokens`, `employerSlashPct`, `treasurySlashPct`, `treasury`.
- `feePool.burnPct`, `feePool.treasury`.
- `jobRegistry.feePct`, `jobRegistry.jobStakeTokens`, `jobRegistry.treasury`.
- `identity` section — set ENS registry (`0x0000…0C2E` on mainnet), NameWrapper, and namehashes. Use the helper:

```bash
npm run namehash:mainnet
```

This script rewrites the `hash` fields from human-readable names so migrations stay deterministic. Commit the file if you are preparing a PR.

## 4. Dry-Run Safety Checks (Optional but Recommended)

Before mainnet, perform a full rehearsal on Sepolia with identical settings:

```bash
# Populate deployment-config/sepolia.json with equivalent values
npm run namehash:sepolia
npm run migrate:sepolia
```

Use this rehearsal to record expected gas usage and ensure the deployer key is funded adequately.

## 5. Execute Mainnet Deployment (Truffle)

1. Confirm `.env` values one last time.
2. Ensure `config/governance-update.json` exists. Start from the example:

   ```bash
   cp config/governance-update.example.json config/governance-update.json
   # Edit with real contract addresses after deployment.
   ```

3. Deploy and wire the system:

   ```bash
   npm run migrate:mainnet
   ```

   This composite command performs:

   - `npm run compile:mainnet` — regenerates constants and compiles with mainnet network selected.
   - `npx truffle migrate --network mainnet --reset` — executes `migrations/1_initial_migration.js` through `4_governance_handover.js`.
   - `npm run wire:verify` — sanity-checks module wiring against configuration files.

4. During migration, copy every address printed in the console onto your log sheet. The deployer emits a summary block listing `StakeManager`, `JobRegistry`, `ValidationModule`, `ReputationEngine`, `DisputeModule`, `CertificateNFT`, `PlatformRegistry`, `JobRouter`, `PlatformIncentives`, `FeePool`, `TaxPolicy`, `IdentityRegistry`, and `SystemPause`.

## 6. Verify Contracts on Etherscan

The migration command triggers verification automatically when `ETHERSCAN_API_KEY` is set. To rerun verification manually (if rate limited):

```bash
npx truffle run verify Deployer StakeManager JobRegistry ValidationModule \
  ReputationEngine DisputeModule CertificateNFT PlatformRegistry JobRouter \
  PlatformIncentives FeePool IdentityRegistry SystemPause TaxPolicy \
  --network mainnet
```

Record the verification URLs alongside each address.

## 7. Post-Deployment Validation

Run automated verifiers against mainnet state:

```bash
# Check $AGIALPHA metadata
npm run verify:agialpha -- --rpc "$MAINNET_RPC_URL"

# Confirm ENS aliases and namehash wiring
npm run verify:ens

# Re-run wiring assertion against live addresses
TRUFFLE_NETWORK=mainnet MAINNET_RPC_URL=$MAINNET_RPC_URL \
  MAINNET_PRIVATE_KEY=$MAINNET_PRIVATE_KEY npm run wire:verify
```

## 8. Tune Economics and Governance Parameters

The repository now ships a consolidated governance helper at `scripts/governance/update-economics.ts`. Populate `config/governance-update.json` with the newly deployed addresses and desired parameters (percentages expressed as whole numbers, token amounts in 18‑decimal `$AGIALPHA` units).

Example snippet:

```json
{
  "jobRegistry": {
    "address": "0xJobRegistry...",
    "feePct": 5,
    "validatorRewardPct": 15,
    "jobStakeTokens": "25",
    "minAgentStakeTokens": "250",
    "treasury": "0xTreasury...",
    "taxPolicy": "0xTaxPolicy...",
    "feePool": "0xFeePool..."
  },
  "stakeManager": {
    "address": "0xStakeManager...",
    "minStakeTokens": "250",
    "employerSlashPct": 50,
    "treasurySlashPct": 10,
    "treasury": "0xTreasury..."
  }
}
```

Dry-run the updates:

```bash
npx hardhat run --network mainnet scripts/governance/update-economics.ts --config config/governance-update.json
```

When the summary looks correct, append `--execute` to submit transactions:

```bash
npx hardhat run --network mainnet scripts/governance/update-economics.ts --config config/governance-update.json --execute
```

Each action prints the current value, desired value, method name, and transaction hash for audit trails.

## 9. Transfer Ownership to Governance

Hand off control to the governance multisig or timelock once parameters are tuned. The repository exposes batch helpers:

```bash
# Dry-run ownership transfer plan (defaults to config/governance-control.json)
npm run owner:plan -- --network mainnet

# Apply transfers once reviewed
npm run owner:apply -- --network mainnet --execute
```

Alternatively, call `setGovernance` / `transferOwnership` from each contract via Etherscan using the addresses recorded earlier.

## 10. Final Safety Checks

- Execute `npm run verify:wiring` the next business day to confirm no drift.
- Store the completed log sheet, `config/governance-update.json`, and deployment console output in your internal document vault.
- Share the `deployment-addresses.json` entry with integrators and UI teams.
- Schedule continuous monitoring following `docs/monitoring.md`.

## Troubleshooting Quick Reference

| Issue                                              | Resolution                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Governance update config not found`               | Copy `config/governance-update.example.json` to `config/governance-update.json`.                                                                                   |
| Truffle migration reverts                          | Re-run with `DEBUG=agijobs npm run migrate:mainnet` to capture verbose logs; most failures stem from misconfigured ENS namehashes or missing `$AGIALPHA` balances. |
| Verification fails                                 | Wait 2–3 minutes and rerun `npx truffle run verify ...`. Ensure `ETHERSCAN_API_KEY` is correct.                                                                    |
| `No signer available` when running Hardhat scripts | Check `MAINNET_PRIVATE_KEY` in `.env` and confirm Hardhat network configuration matches.                                                                           |
| Parameter transaction reverts                      | Verify governance ownership has not yet transferred; the deployer must still be the owner or you must switch to the governance multisig.                           |

With these steps, a non-technical operator can confidently deploy AGIJobs v2, verify the contracts, and adjust all critical parameters from first principles using auditable scripts.
