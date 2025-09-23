# AGIJobs v2 Deployment & Operations Guide

For production deployment steps see [deployment-production-guide.md](deployment-production-guide.md). For a detailed explanation of the system design, consult [architecture-v2.md](architecture-v2.md).

Identity for agents and validators is enforced with the
`ENSOwnershipVerifier` library. Participants must control an ENS
subdomain—`*.agent.agi.eth` for agents and `*.club.agi.eth` for
validators—and supply the subdomain label plus Merkle proof when
interacting. The verifier checks ownership via NameWrapper and the ENS
resolver, emitting `OwnershipVerified` on success. Operators can issue
subdomains and set resolver records as outlined in
[ens-identity-setup.md](ens-identity-setup.md).

## Module Responsibilities & Addresses

| Module            | Responsibility                                                              | Address                                      |
| ----------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| `$AGIALPHA` Token | 18‑decimal ERC‑20 used for payments and staking (external mainnet contract) | `0xA61a3B3a130a9c20768EEBF97E21515A6046a1fA` |
| StakeManager      | Custodies stakes, escrows rewards, slashes misbehaviour                     | `0x0000000000000000000000000000000000000000` |
| ReputationEngine  | Tracks reputation scores and blacklist status                               | `0x0000000000000000000000000000000000000000` |
| IdentityRegistry  | Verifies ENS subdomains and Merkle allowlists                               | `0x0000000000000000000000000000000000000000` |
| ValidationModule  | Runs commit–reveal validation and selects committees                        | `0x0000000000000000000000000000000000000000` |
| DisputeModule     | Escrows dispute fees and finalises appeals                                  | `0x0000000000000000000000000000000000000000` |
| CertificateNFT    | Issues ERC‑721 certificates for completed jobs                              | `0x0000000000000000000000000000000000000000` |
| JobRegistry       | Orchestrates job lifecycle and wires all modules                            | `0x0000000000000000000000000000000000000000` |

## Deployment Script Outline

For a scripted deployment the repository ships with
[`scripts/deployDefaults.ts`](../scripts/deployDefaults.ts). Run:

```bash
npx hardhat run scripts/deployDefaults.ts --network <network>
```

The helper deploys and wires every module using `$AGIALPHA` as the
staking token. Pass `--no-tax` to omit the optional `TaxPolicy` module.
To customise the token, protocol fees or ENS roots edit the script to call
`deployer.deploy(econ, ids)` and provide:

- `econ.token` – ERC‑20 used by `StakeManager` and `FeePool`
- `econ.feePct` / `econ.burnPct` – protocol fee and burn percentages
- `ids.agentRootNode` / `ids.clubRootNode` – namehashes for
  `agent.agi.eth` and `club.agi.eth`
- `ids.agentMerkleRoot` / `ids.validatorMerkleRoot` – optional allowlist
  roots

The script prints module addresses and verifies source on Etherscan.

## Step-by-Step Deployment

1. **Ensure `$AGIALPHA` token exists** – use the external address above or deploy [`contracts/test/AGIALPHAToken.sol`](../contracts/test/AGIALPHAToken.sol) on local networks for testing.
2. **Deploy `StakeManager`** pointing at the token and configuring `_minStake`, `_employerSlashPct`, `_treasurySlashPct` and `_treasury`. Leave `_jobRegistry` and `_disputeModule` as `0`.
3. **Deploy `ReputationEngine`** passing the `StakeManager` address.
4. **Deploy `IdentityRegistry`** with the ENS registry, NameWrapper, `ReputationEngine` address and the namehashes for `agent.agi.eth` and `club.agi.eth`.
5. **Deploy `ValidationModule`** with `jobRegistry = 0`, the `StakeManager` address and desired timing/validator settings.
6. **Deploy `DisputeModule`** with `jobRegistry = 0` and any custom fee or window.
7. **Deploy `CertificateNFT`** supplying a name and symbol.
8. **Deploy `JobRegistry`** passing the governance contract address as the
   final constructor argument, then wire modules by calling
   `setModules(validationModule, stakeManager, reputationEngine, disputeModule, certificateNFT, feePool, new address[](0))` from the
   governance account.
9. **Point modules back to `JobRegistry`** by calling:
   - `StakeManager.setJobRegistry(jobRegistry)`
   - `ValidationModule.setJobRegistry(jobRegistry)`
   - `DisputeModule.setJobRegistry(jobRegistry)`
   - `CertificateNFT.setJobRegistry(jobRegistry)`
   - `CertificateNFT.setStakeManager(stakeManager)` – reverts unless the manager
     reports version 2 and uses the canonical `$AGIALPHA` token
   - `JobRegistry.setTaxPolicy(taxPolicy)` then `DisputeModule.setTaxPolicy(taxPolicy)`
   - `ValidationModule.setIdentityRegistry(identityRegistry)`
10. **Verify source code** – publish each contract on the block explorer using
    `npx hardhat verify --network <network> <address> <constructor args>` or the
    explorer UI so others can audit and interact with it.
11. **Verify wiring** – run `npm run wire:verify -- --network <network>` to confirm module
    getters match the addresses recorded in `config/agialpha.<network>.json` and
    `config/ens.<network>.json`.
12. **Configure ENS and Merkle roots** using `setAgentRootNode`, `setClubRootNode`,
    `setAgentMerkleRoot` and `setValidatorMerkleRoot` on `IdentityRegistry`.
13. **Governance setup** – deploy a multisig wallet or timelock controller
    and pass its address to the `StakeManager` and `JobRegistry` constructors.
    Transfer ownership of every remaining `Ownable` module
    (for example `IdentityRegistry`, `CertificateNFT`, `ValidationModule`,
    `DisputeModule`, `FeePool`, `PlatformRegistry` and related helpers)
    to this governance contract so no single EOA retains control. To rotate
    governance later, the current authority calls `setGovernance(newGov)`.

## Governance Configuration Steps

After deployment the governance contract can fine‑tune the system without redeploying:

1. **Configure `$AGIALPHA`** – `StakeManager` and `FeePool` assume this fixed token.
2. **Set ENS roots** – on `IdentityRegistry` call `setAgentRootNode`,
   `setClubRootNode` and, if using allowlists, `setAgentMerkleRoot` and
   `setValidatorMerkleRoot`.
3. **Update parameters** – adjust economic settings through `setFeePct`,
   `FeePool.setBurnPct` to tune the portion of fees burned before distribution,
   `setMinStake`, timing windows and other governance‑only
   setters or the helper script `scripts/updateParams.ts`.
4. **Publish a tax policy** – call `JobRegistry.setTaxPolicy(taxPolicy)` then
   `DisputeModule.setTaxPolicy(taxPolicy)` and instruct participants to
   acknowledge via `JobRegistry.acknowledgeTaxPolicy()` before staking or
   disputing.

## Interacting via Etherscan

Before any user interaction, open `JobRegistry` → **Write Contract** and
execute `acknowledgeTaxPolicy()` once per address. Subsequent actions can
then be performed through the "Write" tabs on each module.

### Job Creation

1. Approve the job reward on the staking token.
2. In `JobRegistry` → **Write**, call `createJob(reward, uri)`.
3. Watch for `JobCreated(jobId, employer, reward)` in the log.

### Staking

1. Approve tokens on `$AGIALPHA`.
2. In `StakeManager` call `depositStake(role, amount)` (0 = agent,
   1 = validator, 2 = platform).
3. `Staked(role, user, amount)` confirms the bond.

### Applying for a Job

1. Ensure your ENS subdomain is set up and whitelisted.
2. Call `JobRegistry.applyForJob(jobId, subdomain, proof)` or
   `stakeAndApply(jobId, amount, subdomain, proof)`.
3. `ApplicationSubmitted(jobId, agent)` and `AgentAssigned(jobId, agent)` will be emitted.

### Submitting Work

1. The selected agent calls `JobRegistry.submit(jobId, resultHash, resultURI)` when the task is complete.
2. `ResultSubmitted(jobId, resultHash, resultURI)` confirms the submission and triggers validation.

### Validation

1. During commit phase, validators call
   `ValidationModule.commitValidation(jobId, commitHash, subdomain, proof)`.
2. During reveal phase, call
   `revealValidation(jobId, approve, salt, subdomain, proof)`.
3. After reveal, anyone may call `ValidationModule.finalize(jobId)` to record the outcome.
4. The employer then settles the job by calling `JobRegistry.acknowledgeAndFinalize(jobId)` from their own wallet, which releases funds and burns the fee share.

### Dispute

1. Approve the dispute fee on `$AGIALPHA`.
2. Call `JobRegistry.raiseDispute(jobId, evidence)`.
3. Owner or a majority of moderators resolves via `DisputeModule.resolve(jobId, uphold, signatures)`.
4. Monitor `DisputeRaised` and `DisputeResolved` events.

### NFT Marketplace

1. `CertificateNFT` holders list tokens by approving the marketplace and
   calling `list(tokenId, price)`.
2. Buyers call `purchase(tokenId)` after approving the token amount.
3. `TokenPurchased(buyer, tokenId, price)` confirms the sale.

### Minimal Write Transactions

| Action           | Contract / Function                                                | Notes                                           |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| Accept tax terms | `JobRegistry.acknowledgeTaxPolicy()`                               | Must be called once before staking or disputing |
| Stake as agent   | `StakeManager.depositStake(0, amount)`                             | `amount` uses 18‑decimal `$AGIALPHA` units      |
| Post a job       | `JobRegistry.createJob(reward, uri)`                               | `reward` in base units; token must be approved  |
| Commit vote      | `ValidationModule.commitValidation(jobId, hash, subdomain, proof)` | `hash = keccak256(approve, salt)`               |
| Reveal vote      | `ValidationModule.revealValidation(jobId, approve, salt)`          | Call after commit phase closes                  |
| Raise dispute    | `JobRegistry.raiseDispute(jobId, evidence)`                        | Requires prior fee approval                     |
| List certificate | `CertificateNFT.list(tokenId, price)`                              | Price in base units                             |
| Buy certificate  | `CertificateNFT.purchase(tokenId)`                                 | Buyer approves token first                      |

## Owner Administration

### Adjustable Parameters

| Module               | Function                              | Description                                                                 |
| -------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `JobRegistry`        | `setFeePct(pct)`                      | Percentage of each reward taken as protocol fee                             |
| `StakeManager`       | `setMinStake(amount)`                 | Minimum stake required for any role                                         |
| `ValidationModule`   | `setCommitWindow(seconds)`            | Commit phase length for validation votes                                    |
| `ValidationModule`   | `setRevealWindow(seconds)`            | Reveal phase length for validation votes                                    |
| `DisputeModule`      | `setDisputeFee(fee)`                  | Fee required to raise a dispute                                             |
| `FeePool`            | `setBurnPct(pct)`                     | Portion of fees burned before distribution                                  |
| `PlatformIncentives` | `setModules(stake, registry, router)` | Points to the canonical `StakeManager`, `PlatformRegistry`, and `JobRouter` |
| `TaxPolicy`          | `setPolicy(uri, acknowledgementText)` | Rotates the tax-policy pointer and disclaimer shown to participants         |

- **Manage allowlists:** use `JobRegistry.setAgentRootNode(node)` / `setAgentMerkleRoot(root)` for agents and `JobRegistry.setValidatorRootNode(node)` / `setValidatorMerkleRoot(root)` for validators. These call the underlying `IdentityRegistry` setters and automatically bump the `ValidationModule` validator auth cache so outdated entries expire. Add individual addresses with `IdentityRegistry.addAdditionalAgent(addr)` and `addAdditionalValidator(addr)`.
- **Transfer ownership:** hand governance to a multisig or timelock so no
  single key can change parameters:
  - `StakeManager.setGovernance(multisig)`
  - `JobRegistry.setGovernance(multisig)`
  - `transferOwnership(multisig)` on `ValidationModule`, `ReputationEngine`,
    `IdentityRegistry`, `CertificateNFT`, `DisputeModule`, `FeePool`,
    `PlatformRegistry`, `JobRouter`, `PlatformIncentives`, `TaxPolicy` and
    `SystemPause`.
    To rotate later, the current governance executes `setGovernance(newOwner)`
    or `transferOwnership(newOwner)` and waits for the corresponding event
    before using the new address.

### Pause Mechanism

Deploy the optional [`SystemPause`](system-pause.md) contract and wire
module addresses with `setModules`. Governance may call `pauseAll()` to
halt job creation, validation and payouts during emergencies and
`unpauseAll()` to resume. Individual modules also expose standard
`pause()` hooks for targeted stops.

## Token Configuration

- Default staking/reward token: `$AGIALPHA` at
  `0xA61a3B3a130a9c20768EEBF97E21515A6046a1fA` (18 decimals).

## Operational Best Practices

- **Record keeping:** archive deployment transactions, module addresses and
  verification links so upgrades or audits can reference an accurate history.
- **End-to-end testing:** run unit tests with `npm test` and exercise a full job
  flow on a test network before promoting configuration changes to mainnet.
- **Legal compliance:** consult counsel on tax, securities and data-privacy
  obligations in relevant jurisdictions and ensure participants acknowledge the
  posted tax policy.

## ENS Identity Monitor

A lightweight script monitors `IdentityRegistry` for `OwnershipVerified` and `RecoveryInitiated` events and logs anomalies.
Run it with:

```bash
RPC_URL=https://rpc.example IDENTITY_REGISTRY_ADDRESS=0xRegistry node scripts/monitor/ens-monitor.js
```

Logs appear on stdout and in `scripts/monitor/ens-monitor.log`. An "Anomaly detected" message indicates frequent `RecoveryInitiated` events.

## Troubleshooting

- **Missing subdomain proof** – ensure your ENS label and Merkle proof
  match the configured roots.
- **Token approvals** – most functions require prior `approve` calls on
  the staking token.
- **Tax policy** – users must call `acknowledgeTaxPolicy()` on
  `JobRegistry` before staking or disputing.

## Identity Requirements & Merkle Proofs

Agents must control an `*.agent.agi.eth` subdomain and validators a `*.club.agi.eth` subdomain. When applying or validating, supply the subdomain label and a Merkle proof showing your address is allow‑listed.

To generate proofs:

1. Compile a list of permitted addresses and normalise to lowercase.
2. Install dependencies with `npm install merkletreejs keccak256`.
3. Build the tree and extract the root and proofs:
   ```js
   const { MerkleTree } = require('merkletreejs');
   const keccak256 = require('keccak256');
   const whitelist = ['0x1234...', '0xabcd...'];
   const leaves = whitelist.map((a) => keccak256(a));
   const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
   console.log('root:', tree.getHexRoot());
   console.log('proof for first address:', tree.getHexProof(leaves[0]));
   ```
4. Set the root on `IdentityRegistry` using `setAgentMerkleRoot` or `setValidatorMerkleRoot` and supply the proof when interacting with protocol functions.

## Event & Function Glossary

| Event                                                                                                      | Emitted by         | Meaning                                   |
| ---------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------- |
| `JobCreated(uint256 jobId, address employer, uint256 reward)`                                              | `JobRegistry`      | Employer posted a job and escrowed funds. |
| `ApplicationSubmitted(uint256 jobId, address applicant)`                                                   | `JobRegistry`      | Agent submitted an application.           |
| `AgentAssigned(uint256 jobId, address agent)`                                                              | `JobRegistry`      | Agent assignment recorded.                |
| `ValidationCommitted(uint256 jobId, address validator, bytes32 commitHash, string subdomain)`              | `ValidationModule` | Validator submitted hashed vote.          |
| `ValidationRevealed(uint256 jobId, address validator, bool approve, bytes32 burnTxHash, string subdomain)` | `ValidationModule` | Validator revealed vote.                  |
| `DisputeRaised(uint256 jobId, address claimant, bytes32 evidenceHash, string evidence)`                    | `DisputeModule`    | A job result was contested.               |
| `DisputeResolved(uint256 jobId, bool employerWins)`                                                        | `DisputeModule`    | Moderator issued final ruling.            |
| `CertificateMinted(address to, uint256 jobId)`                                                             | `CertificateNFT`   | NFT minted for a completed job.           |

| Function                                                                                         | Module             | Purpose                         |
| ------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------- |
| `createJob(uint256 reward, string uri)`                                                          | `JobRegistry`      | Post a job and lock payout.     |
| `depositStake(uint8 role, uint256 amount)`                                                       | `StakeManager`     | Bond tokens for a role.         |
| `applyForJob(uint256 jobId, string subdomain, bytes32[] proof)`                                  | `JobRegistry`      | Enter candidate pool for a job. |
| `commitValidation(uint256 jobId, bytes32 hash, string subdomain, bytes32[] proof)`               | `ValidationModule` | Submit a hidden vote.           |
| `revealValidation(uint256 jobId, bool approve, bytes32 salt, string subdomain, bytes32[] proof)` | `ValidationModule` | Reveal vote.                    |
| `raiseDispute(uint256 jobId, string reason)`                                                     | `JobRegistry`      | Start appeal process.           |
| `list(uint256 tokenId, uint256 price)`                                                           | `CertificateNFT`   | List job certificate for sale.  |
| `purchase(uint256 tokenId)`                                                                      | `CertificateNFT`   | Buy listed certificate.         |

- **Automation helpers:** Dry-run your changes with
  `npx hardhat run scripts/updatePlatformIncentives.ts --network <network>`
  (rewires module addresses) and
  `npx hardhat run scripts/updateTaxPolicy.ts --network <network>`
  (updates policy URI, acknowledgement text, acknowledger allowlist, or bumps
  the version). Both scripts read defaults from `config/*.json`, ensure the
  connected signer controls the target contract, and print a human-readable
  plan before executing.
