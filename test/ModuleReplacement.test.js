const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { AGIALPHA, AGIALPHA_DECIMALS } = require('../scripts/constants');
const { enrichJob } = require('./utils/jobMetadata');

const Role = { Agent: 0, Validator: 1, Platform: 2 };

async function deploySystem() {
  const [owner, employer, agent] = await ethers.getSigners();

  const token = await ethers.getContractAt(
    'contracts/test/AGIALPHAToken.sol:AGIALPHAToken',
    AGIALPHA
  );
  await token.mint(
    employer.address,
    ethers.parseUnits('1000', AGIALPHA_DECIMALS)
  );
  await token.mint(agent.address, ethers.parseUnits('1000', AGIALPHA_DECIMALS));
  await token.mint(owner.address, ethers.parseUnits('1000', AGIALPHA_DECIMALS));

  const Stake = await ethers.getContractFactory(
    'contracts/StakeManager.sol:StakeManager'
  );
  const stake = await Stake.deploy(
    0,
    0,
    0,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    owner.address
  );
  await stake.waitForDeployment();
  await stake.setMinStake(1);

  const Reputation = await ethers.getContractFactory(
    'contracts/ReputationEngine.sol:ReputationEngine'
  );
  const reputation = await Reputation.deploy(await stake.getAddress());
  await reputation.waitForDeployment();

  const Identity = await ethers.getContractFactory(
    'contracts/mocks/IdentityRegistryMock.sol:IdentityRegistryMock'
  );
  const identity = await Identity.deploy();
  await identity.waitForDeployment();
  await identity.setReputationEngine(await reputation.getAddress());

  const Validation = await ethers.getContractFactory(
    'contracts/mocks/ValidationStub.sol:ValidationStub'
  );
  const validation = await Validation.deploy();
  await validation.waitForDeployment();

  const NFT = await ethers.getContractFactory(
    'contracts/CertificateNFT.sol:CertificateNFT'
  );
  const nft = await NFT.deploy('Cert', 'CERT');
  await nft.waitForDeployment();

  const Registry = await ethers.getContractFactory(
    'contracts/JobRegistry.sol:JobRegistry'
  );
  const registry = await Registry.deploy(
    await validation.getAddress(),
    await stake.getAddress(),
    await reputation.getAddress(),
    ethers.ZeroAddress,
    await nft.getAddress(),
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    0,
    0,
    [],
    owner.address
  );
  await registry.waitForDeployment();

  const Dispute = await ethers.getContractFactory(
    'contracts/modules/DisputeModule.sol:DisputeModule'
  );
  const dispute = await Dispute.deploy(
    await registry.getAddress(),
    0,
    0,
    owner.address
  );
  await dispute.waitForDeployment();

  const FeePool = await ethers.getContractFactory(
    'contracts/FeePool.sol:FeePool'
  );
  const feePool = await FeePool.deploy(
    await stake.getAddress(),
    0,
    ethers.ZeroAddress,
    ethers.ZeroAddress
  );
  await feePool.waitForDeployment();

  await stake.setModules(
    await registry.getAddress(),
    await dispute.getAddress()
  );
  await validation.setJobRegistry(await registry.getAddress());
  await nft.setJobRegistry(await registry.getAddress());
  await nft.setStakeManager(await stake.getAddress());
  await registry.setModules(
    await validation.getAddress(),
    await stake.getAddress(),
    await reputation.getAddress(),
    await dispute.getAddress(),
    await nft.getAddress(),
    await feePool.getAddress(),
    []
  );
  await registry.setIdentityRegistry(await identity.getAddress());
  await reputation.setCaller(await registry.getAddress(), true);
  await stake.connect(owner).setFeePool(await feePool.getAddress());

  return {
    owner,
    employer,
    agent,
    token,
    stake,
    reputation,
    validation,
    nft,
    registry,
    dispute,
    feePool,
  };
}

describe('Module replacement', function () {
  it('preserves job state when swapping validation module via installer', async function () {
    const env = await deploySystem();
    const {
      owner,
      employer,
      agent,
      token,
      stake,
      reputation,
      validation,
      nft,
      registry,
      dispute,
    } = env;

    const stakeAmount = ethers.parseUnits('1', AGIALPHA_DECIMALS);
    await token.connect(agent).approve(await stake.getAddress(), stakeAmount);
    await stake.connect(agent).depositStake(Role.Agent, stakeAmount);

    const reward = ethers.parseUnits('100', AGIALPHA_DECIMALS);
    const fee = (reward * 5n) / 100n;
    await token
      .connect(employer)
      .approve(await stake.getAddress(), reward + fee);
    const deadline = BigInt((await time.latest()) + 3600);
    const specHash = ethers.id('spec');
    await registry
      .connect(employer)
      .createJob(reward, deadline, specHash, 'ipfs://job');

    await registry.connect(agent).applyForJob(1, 'agent', []);
    const hash = ethers.id('ipfs://result');
    await registry.connect(agent).submit(1, hash, 'ipfs://result', 'agent', []);

    const before = enrichJob(await registry.jobs(1));

    const Installer = await ethers.getContractFactory(
      'contracts/ModuleInstaller.sol:ModuleInstaller'
    );
    const installer = await Installer.deploy();
    await installer.waitForDeployment();

    await registry.connect(owner).setGovernance(await installer.getAddress());

    const Validation = await ethers.getContractFactory(
      'contracts/mocks/ValidationStub.sol:ValidationStub'
    );
    const newValidation = await Validation.deploy();
    await newValidation.waitForDeployment();

    await installer
      .connect(owner)
      .replaceValidationModule(
        await registry.getAddress(),
        await newValidation.getAddress(),
        []
      );

    await newValidation.setResult(true);
    await newValidation.finalize(1);
    const burnTxHash = ethers.ZeroHash;
    await registry.connect(employer).submitBurnReceipt(1, burnTxHash, fee, 0);
    await registry.connect(employer).confirmEmployerBurn(1, burnTxHash);
    await registry.connect(employer).finalize(1);

    const after = enrichJob(await registry.jobs(1));
    expect(after.employer).to.equal(before.employer);
    expect(after.agent).to.equal(before.agent);
    expect(after.state).to.equal(6); // Finalized
  });

  it('rejects zero address modules', async function () {
    const env = await deploySystem();
    const { owner, stake } = env;

    await expect(
      stake.connect(owner).setDisputeModule(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(stake, 'InvalidDisputeModule');

    await expect(
      stake.connect(owner).setValidationModule(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(stake, 'InvalidValidationModule');
  });

  it('rejects modules with mismatched versions', async function () {
    const env = await deploySystem();
    const { owner, registry, stake, dispute } = env;
    const Version = await ethers.getContractFactory(
      'contracts/mocks/VersionMock.sol:VersionMock'
    );
    const bad = await Version.deploy(3);

    await expect(
      registry.connect(owner).setDisputeModule(await bad.getAddress())
    ).to.be.revertedWithCustomError(registry, 'InvalidDisputeModule');

    await expect(
      stake.connect(owner).setDisputeModule(await bad.getAddress())
    ).to.be.revertedWithCustomError(stake, 'InvalidDisputeModule');

    await expect(
      stake.connect(owner).setValidationModule(await bad.getAddress())
    ).to.be.revertedWithCustomError(stake, 'InvalidValidationModule');

    await expect(
      stake.connect(owner).setJobRegistry(await bad.getAddress())
    ).to.be.revertedWithCustomError(stake, 'InvalidJobRegistry');

    await expect(
      stake
        .connect(owner)
        .setModules(await bad.getAddress(), await dispute.getAddress())
    ).to.be.revertedWithCustomError(stake, 'InvalidJobRegistry');

    await expect(
      stake
        .connect(owner)
        .setModules(await registry.getAddress(), await bad.getAddress())
    ).to.be.revertedWithCustomError(stake, 'InvalidDisputeModule');
  });
});
