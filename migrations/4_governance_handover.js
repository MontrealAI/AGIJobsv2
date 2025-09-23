const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');

const StakeManager = artifacts.require('StakeManager');
const JobRegistry = artifacts.require('JobRegistry');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const CertificateNFT = artifacts.require('CertificateNFT');
const ReputationEngine = artifacts.require('ReputationEngine');
const IdentityRegistry = artifacts.require('IdentityRegistry');
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

function loadGovernance(network, accounts) {
  const cfgPath = configPathFor(network || 'mainnet');
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const fallback = ethers.getAddress(accounts[0]);
  const normalise = (value, backup) => {
    if (!value) return backup;
    const addr = ethers.getAddress(value);
    if (addr === ethers.ZeroAddress) return backup;
    return addr;
  };
  const initial = normalise(raw?.governance?.initial, fallback);
  const final = normalise(raw?.governance?.final, initial);
  return {
    initial,
    final,
  };
}

module.exports = async function (deployer, network, accounts) {
  const { initial, final } = loadGovernance(network, accounts);
  const same = initial.toLowerCase() === final.toLowerCase();

  const stakeManager = await StakeManager.deployed();
  const jobRegistry = await JobRegistry.deployed();
  const validation = await ValidationModule.deployed();
  const dispute = await DisputeModule.deployed();
  const certificate = await CertificateNFT.deployed();
  const reputation = await ReputationEngine.deployed();
  const identity = await IdentityRegistry.deployed();
  const feePool = await FeePool.deployed();
  let taxPolicyInstance;
  if (TaxPolicy) {
    try {
      taxPolicyInstance = await TaxPolicy.deployed();
    } catch (_) {
      taxPolicyInstance = null;
    }
  }

  if (!same) {
    await stakeManager.setGovernance(final, { from: initial });
    await jobRegistry.setGovernance(final, { from: initial });
  }

  await feePool.setGovernance(final, { from: accounts[0] });

  const ownableModules = [
    validation,
    dispute,
    certificate,
    reputation,
    feePool,
  ];

  for (const module of ownableModules) {
    if (!module.transferOwnership) continue;
    const currentOwner = (await module.owner()).toString();
    if (currentOwner.toLowerCase() === final.toLowerCase()) continue;
    await module.transferOwnership(final, { from: accounts[0] });
  }

  const twoStep = [identity, taxPolicyInstance].filter(Boolean);
  for (const module of twoStep) {
    const currentOwner = (await module.owner()).toString();
    if (currentOwner.toLowerCase() === final.toLowerCase()) continue;
    await module.transferOwnership(final, { from: accounts[0] });
    if (
      final.toLowerCase() === accounts[0].toLowerCase() &&
      module.acceptOwnership
    ) {
      await module.acceptOwnership({ from: final });
    }
  }
};
