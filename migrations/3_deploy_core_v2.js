const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const StakeManager = artifacts.require('StakeManager');
const ReputationEngine = artifacts.require('ReputationEngine');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const CertificateNFT = artifacts.require('CertificateNFT');
const JobRegistry = artifacts.require('JobRegistry');
const FeePool = artifacts.require('FeePool');
let TaxPolicy;
try {
  TaxPolicy = artifacts.require('TaxPolicy');
} catch (_) {
  TaxPolicy = null;
}

function configPathFor(network) {
  const base = path.join(__dirname, '..', 'deployment-config');
  const specific = path.join(base, `${network}.json`);
  if (fs.existsSync(specific)) return specific;
  return path.join(base, 'mainnet.json');
}

function parseAddress(value, fallback, { allowZero = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) {
      return parseAddress(fallback, undefined, { allowZero });
    }
    if (allowZero) return ethers.ZeroAddress;
    throw new Error('Address value missing');
  }
  const addr = ethers.getAddress(value);
  if (addr === ethers.ZeroAddress) {
    if (allowZero) return addr;
    if (fallback !== undefined) {
      return parseAddress(fallback, undefined, { allowZero });
    }
    throw new Error('Address cannot be zero');
  }
  return addr;
}

function parseBytes32(value, fallback = ethers.ZeroHash) {
  if (!value) return fallback;
  const hex = value.startsWith('0x') ? value : `0x${value}`;
  if (!ethers.isHexString(hex, 32)) {
    throw new Error(`Invalid bytes32 value: ${value}`);
  }
  return hex;
}

function parsePct(value, fallback = 0) {
  const candidate = value === undefined || value === null ? fallback : value;
  const pct = Number(candidate);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error(`Invalid percentage: ${value}`);
  }
  return Math.round(pct);
}

function parseSeconds(value, fallback = 0) {
  const candidate = value === undefined || value === null ? fallback : value;
  const seconds = Number(candidate);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`Invalid seconds value: ${value}`);
  }
  return Math.floor(seconds);
}

function parseTokens(value, fallback) {
  const candidate = value === undefined || value === null ? fallback : value;
  if (candidate === undefined || candidate === null) {
    return ethers.toBigInt(0).toString();
  }
  const amount = ethers.parseUnits(String(candidate), 18);
  return amount.toString();
}

function uniqAddresses(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value) continue;
    const addr = ethers.getAddress(value);
    if (!seen.has(addr)) {
      seen.add(addr);
      result.push(addr);
    }
  }
  return result;
}

function loadConfig(network, accounts) {
  const cfgPath = configPathFor(network || 'mainnet');
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const clone = JSON.parse(JSON.stringify(raw));

  const defaults = {
    initial: accounts[0],
    final: accounts[0],
  };
  if (!clone.governance) clone.governance = {};
  const initialCandidate =
    clone.governance.initial && clone.governance.initial !== ethers.ZeroAddress
      ? clone.governance.initial
      : defaults.initial;
  const finalCandidate =
    clone.governance.final && clone.governance.final !== ethers.ZeroAddress
      ? clone.governance.final
      : initialCandidate || defaults.final;
  const initial = parseAddress(initialCandidate, defaults.initial, {
    allowZero: false,
  });
  const final = parseAddress(finalCandidate, initial, { allowZero: false });
  clone.governance = { initial, final };
  return { config: clone, path: cfgPath };
}

function writeAddresses(network, addresses) {
  const outDir = path.join(__dirname, '..', 'deployment-config');
  const outPath = path.join(outDir, `${network || 'mainnet'}.addresses.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(addresses, null, 2)}\n`);
}

module.exports = async function (deployer, network, accounts) {
  const { config: cfg } = loadConfig(network, accounts);
  const netKey = (network || 'mainnet').toLowerCase();

  const governanceAccount = cfg.governance.initial;
  const finalGovernance = cfg.governance.final;

  const stakeCfg = cfg.stakeManager || {};
  const validationCfg = cfg.validation || {};
  const disputeCfg = cfg.dispute || {};
  const feeCfg = cfg.feePool || {};
  const jobCfg = cfg.jobRegistry || {};
  const identityCfg = cfg.identity || cfg.ens || {};
  const certCfg = cfg.certificate || {};
  const taxCfg = cfg.taxPolicy || {};

  const minStake = parseTokens(
    stakeCfg.minStakeTokens ?? stakeCfg.minStake ?? '0'
  );
  const employerSlashPct = parsePct(stakeCfg.employerSlashPct, 0);
  const treasurySlashPct = parsePct(
    stakeCfg.treasurySlashPct,
    100 - employerSlashPct
  );
  const stakeTreasury = parseAddress(stakeCfg.treasury, ethers.ZeroAddress, {
    allowZero: true,
  });

  await deployer.deploy(
    StakeManager,
    minStake,
    employerSlashPct,
    treasurySlashPct,
    stakeTreasury,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    governanceAccount
  );
  const stakeManager = await StakeManager.deployed();

  await deployer.deploy(ReputationEngine, stakeManager.address);
  const reputation = await ReputationEngine.deployed();

  await deployer.deploy(
    IdentityRegistry,
    parseAddress(identityCfg.ens, ethers.ZeroAddress, { allowZero: true }),
    parseAddress(identityCfg.nameWrapper, ethers.ZeroAddress, {
      allowZero: true,
    }),
    reputation.address,
    parseBytes32(identityCfg.agentRootNode),
    parseBytes32(identityCfg.clubRootNode)
  );
  const identity = await IdentityRegistry.deployed();

  const commitWindow = parseSeconds(validationCfg.commitWindow, 3600);
  const revealWindow = parseSeconds(validationCfg.revealWindow, 3600);
  const minValidators = Number(validationCfg.minValidators ?? 1);
  const maxValidators = Number(
    validationCfg.maxValidators ?? Math.max(minValidators, 3)
  );
  const validatorPool = (validationCfg.validatorPool || []).map((addr) =>
    parseAddress(addr, undefined, { allowZero: false })
  );

  await deployer.deploy(
    ValidationModule,
    ethers.ZeroAddress,
    stakeManager.address,
    commitWindow,
    revealWindow,
    minValidators,
    maxValidators,
    validatorPool
  );
  const validation = await ValidationModule.deployed();

  const disputeFee = parseTokens(disputeCfg.feeTokens ?? disputeCfg.fee ?? '0');
  const disputeWindow = parseSeconds(disputeCfg.window, 86400);
  await deployer.deploy(
    DisputeModule,
    ethers.ZeroAddress,
    disputeFee,
    disputeWindow,
    parseAddress(disputeCfg.committee, ethers.ZeroAddress, { allowZero: true })
  );
  const dispute = await DisputeModule.deployed();

  const certName = certCfg.name || 'AGI Certificate';
  const certSymbol = certCfg.symbol || 'AGICERT';
  await deployer.deploy(CertificateNFT, certName, certSymbol);
  const certificate = await CertificateNFT.deployed();

  let taxPolicyAddress = taxCfg.address
    ? parseAddress(taxCfg.address, undefined, { allowZero: true })
    : ethers.ZeroAddress;
  let taxPolicyInstance;
  if (
    taxCfg.deploy !== false &&
    TaxPolicy &&
    taxPolicyAddress === ethers.ZeroAddress
  ) {
    const uri = taxCfg.uri || 'ipfs://example';
    const ack = taxCfg.ack || 'Participants accept all tax responsibilities.';
    await deployer.deploy(TaxPolicy, uri, ack);
    taxPolicyInstance = await TaxPolicy.deployed();
    taxPolicyAddress = taxPolicyInstance.address;
  }

  await deployer.deploy(
    FeePool,
    stakeManager.address,
    parsePct(feeCfg.burnPct, 5),
    parseAddress(feeCfg.treasury, ethers.ZeroAddress, { allowZero: true }),
    taxPolicyAddress
  );
  const feePool = await FeePool.deployed();

  const feePct = parsePct(jobCfg.feePct, 5);
  const jobStake = parseTokens(jobCfg.jobStakeTokens ?? jobCfg.jobStake ?? '0');
  const ackModules = uniqAddresses(jobCfg.ackModules || []);

  await deployer.deploy(
    JobRegistry,
    validation.address,
    stakeManager.address,
    reputation.address,
    dispute.address,
    certificate.address,
    feePool.address,
    taxPolicyAddress,
    feePct,
    jobStake,
    ackModules,
    governanceAccount
  );
  const jobRegistry = await JobRegistry.deployed();

  const addresses = {
    StakeManager: stakeManager.address,
    ReputationEngine: reputation.address,
    IdentityRegistry: identity.address,
    ValidationModule: validation.address,
    DisputeModule: dispute.address,
    CertificateNFT: certificate.address,
    JobRegistry: jobRegistry.address,
    FeePool: feePool.address,
  };
  if (taxPolicyInstance) {
    addresses.TaxPolicy = taxPolicyInstance.address;
  } else if (taxPolicyAddress !== ethers.ZeroAddress) {
    addresses.TaxPolicy = taxPolicyAddress;
  }
  writeAddresses(netKey, addresses);

  if (taxPolicyInstance) {
    await taxPolicyInstance.setAcknowledger(jobRegistry.address, true, {
      from: accounts[0],
    });
  }

  await jobRegistry.setModules(
    validation.address,
    stakeManager.address,
    reputation.address,
    dispute.address,
    certificate.address,
    feePool.address,
    ackModules,
    { from: governanceAccount }
  );

  if (jobCfg.treasury) {
    await jobRegistry.setTreasury(
      parseAddress(jobCfg.treasury, ethers.ZeroAddress, { allowZero: true }),
      { from: governanceAccount }
    );
  }
  if (taxPolicyAddress !== ethers.ZeroAddress) {
    await jobRegistry.setTaxPolicy(taxPolicyAddress, {
      from: governanceAccount,
    });
    await jobRegistry.setAcknowledger(governanceAccount, true, {
      from: governanceAccount,
    });
    await jobRegistry.acknowledgeFor(stakeManager.address, {
      from: governanceAccount,
    });
    await jobRegistry.acknowledgeFor(validation.address, {
      from: governanceAccount,
    });
    await jobRegistry.acknowledgeFor(dispute.address, {
      from: governanceAccount,
    });
    await jobRegistry.acknowledgeFor(feePool.address, {
      from: governanceAccount,
    });
  }

  await stakeManager.setModules(jobRegistry.address, dispute.address, {
    from: governanceAccount,
  });
  await stakeManager.setValidationModule(validation.address, {
    from: governanceAccount,
  });
  await stakeManager.setFeePool(feePool.address, { from: governanceAccount });
  if (stakeTreasury !== ethers.ZeroAddress) {
    await stakeManager.setTreasury(stakeTreasury, { from: governanceAccount });
  }

  await validation.setJobRegistry(jobRegistry.address, { from: accounts[0] });
  await validation.setIdentityRegistry(identity.address, { from: accounts[0] });
  await validation.setReputationEngine(reputation.address, {
    from: accounts[0],
  });
  if (validationCfg.validatorsPerJob !== undefined) {
    await validation.setValidatorsPerJob(
      Number(validationCfg.validatorsPerJob),
      { from: accounts[0] }
    );
  }
  if (validatorPool.length > 0) {
    await validation.setValidatorPool(validatorPool, { from: accounts[0] });
  }
  await validation.setCommitWindow(commitWindow, { from: accounts[0] });
  await validation.setRevealWindow(revealWindow, { from: accounts[0] });
  await validation.setValidatorBounds(minValidators, maxValidators, {
    from: accounts[0],
  });

  await dispute.setJobRegistry(jobRegistry.address, { from: accounts[0] });
  await dispute.setStakeManager(stakeManager.address, { from: accounts[0] });
  if (disputeCfg.committee) {
    await dispute.setCommittee(
      parseAddress(disputeCfg.committee, ethers.ZeroAddress, {
        allowZero: true,
      }),
      { from: accounts[0] }
    );
  }
  await dispute.setDisputeFee(disputeFee, { from: accounts[0] });
  await dispute.setDisputeWindow(disputeWindow, { from: accounts[0] });

  await certificate.setJobRegistry(jobRegistry.address, { from: accounts[0] });
  await certificate.setStakeManager(stakeManager.address, {
    from: accounts[0],
  });
  if (certCfg.baseURI) {
    await certificate.setBaseURI(certCfg.baseURI, { from: accounts[0] });
  }

  await feePool.setStakeManager(stakeManager.address, { from: accounts[0] });
  await feePool.setGovernance(governanceAccount, { from: accounts[0] });
  if (taxPolicyAddress !== ethers.ZeroAddress) {
    await feePool.setTaxPolicy(taxPolicyAddress, { from: accounts[0] });
  }
  if (feeCfg.treasury) {
    await feePool.setTreasury(
      parseAddress(feeCfg.treasury, ethers.ZeroAddress, { allowZero: true }),
      { from: accounts[0] }
    );
  }
  await feePool.setBurnPct(parsePct(feeCfg.burnPct, 5), { from: accounts[0] });

  await jobRegistry.setIdentityRegistry(identity.address, {
    from: governanceAccount,
  });
  await reputation.setCaller(jobRegistry.address, true, { from: accounts[0] });
  await reputation.setCaller(validation.address, true, { from: accounts[0] });

  await identity.setAgentRootNode(parseBytes32(identityCfg.agentRootNode), {
    from: accounts[0],
  });
  await identity.setClubRootNode(parseBytes32(identityCfg.clubRootNode), {
    from: accounts[0],
  });
  await identity.setAgentMerkleRoot(parseBytes32(identityCfg.agentMerkleRoot), {
    from: accounts[0],
  });
  await identity.setValidatorMerkleRoot(
    parseBytes32(identityCfg.validatorMerkleRoot),
    { from: accounts[0] }
  );

  console.log('StakeManager:', stakeManager.address);
  console.log('JobRegistry:', jobRegistry.address);
  console.log('ValidationModule:', validation.address);
  console.log('ReputationEngine:', reputation.address);
  console.log('DisputeModule:', dispute.address);
  console.log('CertificateNFT:', certificate.address);
  console.log('FeePool:', feePool.address);
  if (taxPolicyAddress !== ethers.ZeroAddress) {
    console.log('TaxPolicy:', taxPolicyAddress);
  }
  console.log('IdentityRegistry:', identity.address);
};
