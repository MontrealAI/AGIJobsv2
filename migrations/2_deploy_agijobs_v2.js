'use strict';

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const {
  loadTokenConfig,
  loadJobRegistryConfig,
  loadStakeManagerConfig,
  loadFeePoolConfig,
  loadEnsConfig,
  inferNetworkKey,
} = require('../scripts/config');

const Deployer = artifacts.require('Deployer');
const StakeManager = artifacts.require('StakeManager');
const JobRegistry = artifacts.require('JobRegistry');
const DisputeModule = artifacts.require('DisputeModule');
const PlatformRegistry = artifacts.require('PlatformRegistry');
const JobRouter = artifacts.require('JobRouter');
const PlatformIncentives = artifacts.require('PlatformIncentives');
const SystemPause = artifacts.require('SystemPause');

const UINT96_MAX = (1n << 96n) - 1n;
const ZERO_ADDRESS = ethers.ZeroAddress;
const ZERO_HASH = ethers.ZeroHash;

function ensureAddress(value, label, { allowZero = false } = {}) {
  if (value === undefined || value === null) {
    if (allowZero) return ZERO_ADDRESS;
    throw new Error(`${label} is not configured`);
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    if (allowZero) return ZERO_ADDRESS;
    throw new Error(`${label} is not configured`);
  }
  const prefixed = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  const address = ethers.getAddress(prefixed);
  if (!allowZero && address === ZERO_ADDRESS) {
    throw new Error(`${label} cannot be the zero address`);
  }
  return address;
}

function sameAddress(a, b) {
  if (!a || !b) {
    return false;
  }
  return ethers.getAddress(a) === ethers.getAddress(b);
}

function pickDefined(...candidates) {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length === 0) {
        continue;
      }
      return trimmed;
    }
    return candidate;
  }
  return undefined;
}

function parsePct(value, fallback = 0) {
  const candidate = pickDefined(value, fallback);
  if (candidate === undefined) {
    return 0;
  }
  const raw = Number(candidate);
  if (!Number.isFinite(raw) || raw < 0) {
    throw new Error(`Invalid percentage value: ${candidate}`);
  }
  if (raw > 100) {
    throw new Error(`Percentage value exceeds 100: ${candidate}`);
  }
  return Math.round(raw);
}

function parseSeconds(value, fallback = 0) {
  const candidate = pickDefined(value, fallback);
  if (candidate === undefined) {
    return 0;
  }
  const raw = Number(candidate);
  if (!Number.isFinite(raw) || raw < 0) {
    throw new Error(`Invalid seconds value: ${candidate}`);
  }
  return Math.floor(raw);
}

function toUnits(value, decimals, { clamp96 = false } = {}) {
  const candidate = pickDefined(value);
  if (candidate === undefined) {
    return '0';
  }
  const amount = ethers.parseUnits(String(candidate), decimals);
  if (clamp96 && amount > UINT96_MAX) {
    throw new Error(`Value ${candidate} exceeds uint96 range`);
  }
  return amount.toString();
}

function persistAddresses(addresses, tokenConfigPath, tokenConfig) {
  const docsPath = path.join(
    __dirname,
    '..',
    'docs',
    'deployment-addresses.json'
  );
  let docsData = {};
  if (fs.existsSync(docsPath)) {
    docsData = JSON.parse(fs.readFileSync(docsPath, 'utf8'));
  }
  const updatedDocs = { ...docsData, ...addresses };
  if (docsData._comment && !('_comment' in updatedDocs)) {
    updatedDocs._comment = docsData._comment;
  }
  fs.writeFileSync(docsPath, `${JSON.stringify(updatedDocs, null, 2)}\n`);

  if (tokenConfig && typeof tokenConfig === 'object') {
    const existing =
      tokenConfig.modules && typeof tokenConfig.modules === 'object'
        ? { ...tokenConfig.modules }
        : {};
    const nextModules = { ...existing };
    for (const [key, value] of Object.entries(addresses)) {
      if (key in nextModules) {
        nextModules[key] = value;
      }
    }
    const nextConfig = { ...tokenConfig, modules: nextModules };
    fs.writeFileSync(
      tokenConfigPath,
      `${JSON.stringify(nextConfig, null, 2)}\n`
    );
  }
}

module.exports = async function (deployer, currentNetwork, accounts) {
  const networkKey =
    inferNetworkKey(currentNetwork) ||
    inferNetworkKey(process.env.TRUFFLE_NETWORK);
  const governance = ensureAddress(
    process.env.GOVERNANCE_ADDRESS || accounts[0],
    'Governance address'
  );
  const withTax = !process.env.NO_TAX;

  const tokenConfigResult = loadTokenConfig({ network: networkKey });
  const tokenConfig = tokenConfigResult.config || {};
  const tokenConfigPath = tokenConfigResult.path;
  const decimals = Number(tokenConfig.decimals ?? 18);
  if (!Number.isFinite(decimals) || decimals < 0) {
    throw new Error('Invalid AGIALPHA decimals configured');
  }

  const jobRegistryConfig =
    loadJobRegistryConfig({ network: networkKey }).config || {};
  let stakeManagerConfig = {};
  try {
    stakeManagerConfig =
      loadStakeManagerConfig({ network: networkKey }).config || {};
  } catch {}
  let feePoolConfig = {};
  try {
    feePoolConfig = loadFeePoolConfig({ network: networkKey }).config || {};
  } catch {}

  const feePct = parsePct(process.env.FEE_PCT, jobRegistryConfig.feePct);
  const burnPct = parsePct(process.env.BURN_PCT, feePoolConfig.burnPct);
  const employerSlashPct = parsePct(
    process.env.EMPLOYER_SLASH_PCT,
    stakeManagerConfig.employerSlashPct
  );
  const treasurySlashPct = parsePct(
    process.env.TREASURY_SLASH_PCT,
    stakeManagerConfig.treasurySlashPct
  );
  const commitWindow = parseSeconds(
    process.env.COMMIT_WINDOW_SECONDS || process.env.COMMIT_WINDOW,
    jobRegistryConfig.commitWindowSeconds
  );
  const revealWindow = parseSeconds(
    process.env.REVEAL_WINDOW_SECONDS || process.env.REVEAL_WINDOW,
    jobRegistryConfig.revealWindowSeconds
  );

  const minStakeTokens = pickDefined(
    process.env.MIN_STAKE_TOKENS,
    stakeManagerConfig.minStakeTokens,
    jobRegistryConfig.minAgentStakeTokens
  );
  const jobStakeTokens = pickDefined(
    process.env.JOB_STAKE_TOKENS,
    jobRegistryConfig.jobStakeTokens
  );

  const econ = {
    feePct,
    burnPct,
    employerSlashPct,
    treasurySlashPct,
    commitWindow,
    revealWindow,
    minStake: toUnits(minStakeTokens, decimals),
    jobStake: toUnits(jobStakeTokens, decimals, { clamp96: true }),
  };

  const ensConfig =
    loadEnsConfig({ network: networkKey, persist: true }).config || {};
  const roots = ensConfig.roots || {};
  const agentRoot = roots.agent || {};
  const clubRoot = roots.club || {};

  const ids = {
    ens: ensureAddress(ensConfig.registry, 'ENS registry'),
    nameWrapper: ensureAddress(
      ensConfig.nameWrapper || ZERO_ADDRESS,
      'ENS name wrapper',
      {
        allowZero: true,
      }
    ),
    clubRootNode: clubRoot.node ? ethers.hexlify(clubRoot.node) : ZERO_HASH,
    agentRootNode: agentRoot.node ? ethers.hexlify(agentRoot.node) : ZERO_HASH,
    validatorMerkleRoot: clubRoot.merkleRoot
      ? ethers.hexlify(clubRoot.merkleRoot)
      : ZERO_HASH,
    agentMerkleRoot: agentRoot.merkleRoot
      ? ethers.hexlify(agentRoot.merkleRoot)
      : ZERO_HASH,
  };

  if (ids.clubRootNode === ZERO_HASH || ids.agentRootNode === ZERO_HASH) {
    throw new Error(
      'ENS configuration is missing required agent/club root nodes'
    );
  }

  await deployer.deploy(Deployer);
  const instance = await Deployer.deployed();

  let receipt;
  if (withTax) {
    receipt = await instance.deploy(econ, ids, governance);
  } else {
    receipt = await instance.deployWithoutTaxPolicy(econ, ids, governance);
  }

  const log = receipt.logs.find((entry) => entry.event === 'Deployed');
  if (!log || !log.args) {
    throw new Error('Deployed event not found in receipt');
  }

  const disputeInstance = await DisputeModule.at(log.args.disputeModule);
  const arbitratorCommitteeAddress = await disputeInstance.committee();
  if (arbitratorCommitteeAddress === ZERO_ADDRESS) {
    throw new Error(
      'Arbitrator committee was not configured during deployment'
    );
  }

  const deployedAddresses = {
    stakeManager: log.args.stakeManager,
    jobRegistry: log.args.jobRegistry,
    validationModule: log.args.validationModule,
    reputationEngine: log.args.reputationEngine,
    disputeModule: log.args.disputeModule,
    arbitratorCommittee: arbitratorCommitteeAddress,
    certificateNFT: log.args.certificateNFT,
    platformRegistry: log.args.platformRegistry,
    jobRouter: log.args.jobRouter,
    platformIncentives: log.args.platformIncentives,
    feePool: log.args.feePool,
    taxPolicy: log.args.taxPolicy,
    identityRegistry: log.args.identityRegistryAddr,
    systemPause: log.args.systemPause,
  };

  const {
    stakeManager,
    jobRegistry,
    validationModule,
    reputationEngine,
    disputeModule,
    arbitratorCommittee,
    certificateNFT,
    platformRegistry,
    jobRouter,
    platformIncentives,
    feePool,
    taxPolicy,
    identityRegistry,
    systemPause,
  } = deployedAddresses;

  const stakeManagerInstance = await StakeManager.at(stakeManager);
  const jobRegistryInstance = await JobRegistry.at(jobRegistry);
  const platformRegistryInstance = await PlatformRegistry.at(platformRegistry);
  const jobRouterInstance = await JobRouter.at(jobRouter);
  const platformIncentivesInstance = await PlatformIncentives.at(
    platformIncentives
  );
  const systemPauseInstance = await SystemPause.at(systemPause);

  const governanceAccount = accounts.find((acct) =>
    sameAddress(acct, governance)
  );
  if (!governanceAccount) {
    console.warn(
      `Governance address ${governance} is not available in the local signer set; governance-owned wiring calls will be skipped.`
    );
  }

  const registryHasIncentives = await platformRegistryInstance.registrars(
    platformIncentives
  );
  if (!registryHasIncentives) {
    throw new Error(
      'PlatformIncentives is not registered with PlatformRegistry; ensure registrar wiring is executed.'
    );
  }

  const routerHasIncentives = await jobRouterInstance.registrars(
    platformIncentives
  );
  if (!routerHasIncentives) {
    throw new Error(
      'PlatformIncentives is not registered with JobRouter; ensure registrar wiring is executed.'
    );
  }

  const stakeRegistry = await stakeManagerInstance.jobRegistry();
  const stakeDispute = await stakeManagerInstance.disputeModule();
  if (
    !sameAddress(stakeRegistry, jobRegistry) ||
    !sameAddress(stakeDispute, disputeModule)
  ) {
    throw new Error(
      'StakeManager modules are not wired to the deployed registry/dispute module'
    );
  }

  const stakeOwner = await stakeManagerInstance.owner();
  if (!sameAddress(stakeOwner, systemPause)) {
    throw new Error(
      'StakeManager governance was not transferred to SystemPause'
    );
  }

  const registryOwner = await jobRegistryInstance.owner();
  if (!sameAddress(registryOwner, systemPause)) {
    throw new Error(
      'JobRegistry governance was not transferred to SystemPause'
    );
  }

  if (governanceAccount) {
    const incentivesStake = await platformIncentivesInstance.stakeManager();
    const incentivesRegistry =
      await platformIncentivesInstance.platformRegistry();
    const incentivesRouter = await platformIncentivesInstance.jobRouter();
    if (
      !sameAddress(incentivesStake, stakeManager) ||
      !sameAddress(incentivesRegistry, platformRegistry) ||
      !sameAddress(incentivesRouter, jobRouter)
    ) {
      await platformIncentivesInstance.setModules(
        stakeManager,
        platformRegistry,
        jobRouter,
        { from: governanceAccount }
      );
    }

    await systemPauseInstance.setModules(
      jobRegistry,
      stakeManager,
      validationModule,
      disputeModule,
      platformRegistry,
      feePool,
      reputationEngine,
      arbitratorCommittee,
      { from: governanceAccount }
    );
  }

  console.log('Deployer:', instance.address);
  console.log('StakeManager:', stakeManager);
  console.log('JobRegistry:', jobRegistry);
  console.log('ValidationModule:', validationModule);
  console.log('ReputationEngine:', reputationEngine);
  console.log('DisputeModule:', disputeModule);
  console.log('ArbitratorCommittee:', arbitratorCommittee);
  console.log('CertificateNFT:', certificateNFT);
  console.log('PlatformRegistry:', platformRegistry);
  console.log('JobRouter:', jobRouter);
  console.log('PlatformIncentives:', platformIncentives);
  console.log('FeePool:', feePool);
  if (withTax) {
    console.log('TaxPolicy:', taxPolicy);
  }
  console.log('IdentityRegistry:', identityRegistry);
  console.log('SystemPause:', systemPause);

  persistAddresses(deployedAddresses, tokenConfigPath, tokenConfig);

  if (process.env.ETHERSCAN_API_KEY) {
    const baseContracts = [
      'Deployer',
      'StakeManager',
      'JobRegistry',
      'ValidationModule',
      'ReputationEngine',
      'DisputeModule',
      'CertificateNFT',
      'PlatformRegistry',
      'JobRouter',
      'PlatformIncentives',
      'ArbitratorCommittee',
      'FeePool',
      'IdentityRegistry',
      'SystemPause',
    ];
    if (withTax) {
      baseContracts.push('TaxPolicy');
    }
    try {
      const { execSync } = require('child_process');
      const contractList = baseContracts.join(' ');
      const cmd = `npx truffle run verify ${contractList} --network ${currentNetwork}`;
      console.log('Running:', cmd);
      execSync(cmd, { stdio: 'inherit' });
    } catch (err) {
      console.error('Verification failed:', err.message);
    }
  } else {
    console.log('ETHERSCAN_API_KEY not set; skipping auto-verify.');
  }
};
