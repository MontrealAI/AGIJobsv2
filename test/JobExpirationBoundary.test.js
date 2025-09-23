const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { enrichJob } = require('./utils/jobMetadata');

describe('Job expiration boundary', function () {
  const { AGIALPHA } = require('../scripts/constants');
  let token,
    stakeManager,
    rep,
    validation,
    nft,
    registry,
    dispute,
    policy,
    feePool;
  let owner, employer, agent, treasury;
  const reward = 100;
  const stake = 200;

  beforeEach(async () => {
    [owner, employer, agent, treasury] = await ethers.getSigners();
    token = await ethers.getContractAt(
      'contracts/test/AGIALPHAToken.sol:AGIALPHAToken',
      AGIALPHA
    );
    const StakeManager = await ethers.getContractFactory(
      'contracts/StakeManager.sol:StakeManager'
    );
    stakeManager = await StakeManager.deploy(
      0,
      100,
      0,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      owner.address
    );
    await stakeManager.connect(owner).setMinStake(1);
    await stakeManager.connect(owner).setSlashingPercentages(100, 0);
    const Validation = await ethers.getContractFactory(
      'contracts/mocks/ValidationStub.sol:ValidationStub'
    );
    validation = await Validation.deploy();
    const Rep = await ethers.getContractFactory(
      'contracts/ReputationEngine.sol:ReputationEngine'
    );
    rep = await Rep.deploy(await stakeManager.getAddress());
    const NFT = await ethers.getContractFactory(
      'contracts/modules/CertificateNFT.sol:CertificateNFT'
    );
    nft = await NFT.deploy('Cert', 'CERT');
    const FeePool = await ethers.getContractFactory(
      'contracts/FeePool.sol:FeePool'
    );
    feePool = await FeePool.deploy(
      await stakeManager.getAddress(),
      0,
      ethers.ZeroAddress,
      ethers.ZeroAddress
    );
    const Registry = await ethers.getContractFactory(
      'contracts/JobRegistry.sol:JobRegistry'
    );
    registry = await Registry.deploy(
      ethers.ZeroAddress,
      await stakeManager.getAddress(),
      await rep.getAddress(),
      ethers.ZeroAddress,
      await nft.getAddress(),
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      0,
      0,
      [],
      owner.address
    );
    const Dispute = await ethers.getContractFactory(
      'contracts/modules/DisputeModule.sol:DisputeModule'
    );
    dispute = await Dispute.deploy(
      await registry.getAddress(),
      0,
      0,
      ethers.ZeroAddress
    );
    await stakeManager
      .connect(owner)
      .setDisputeModule(await dispute.getAddress());
    await registry
      .connect(owner)
      .setModules(
        await validation.getAddress(),
        await stakeManager.getAddress(),
        await rep.getAddress(),
        await dispute.getAddress(),
        await nft.getAddress(),
        await feePool.getAddress(),
        []
      );
    await validation.setJobRegistry(await registry.getAddress());
    await stakeManager
      .connect(owner)
      .setJobRegistry(await registry.getAddress());
    await stakeManager
      .connect(owner)
      .setValidationModule(await validation.getAddress());
    await stakeManager.connect(owner).setFeePool(await feePool.getAddress());
    const Identity = await ethers.getContractFactory(
      'contracts/mocks/IdentityRegistryMock.sol:IdentityRegistryMock'
    );
    const identity = await Identity.deploy();
    await registry
      .connect(owner)
      .setIdentityRegistry(await identity.getAddress());
    await rep
      .connect(owner)
      .setAuthorizedCaller(await registry.getAddress(), true);
    await rep.connect(owner).setThreshold(0);
    await registry.connect(owner).setJobParameters(reward, stake);
    await registry.connect(owner).setMaxJobReward(1000000);
    await registry.connect(owner).setJobDurationLimit(1000);
    await registry.connect(owner).setFeePct(0);
    await registry.connect(owner).setValidatorRewardPct(0);
    const Policy = await ethers.getContractFactory(
      'contracts/TaxPolicy.sol:TaxPolicy'
    );
    policy = await Policy.deploy('ipfs://policy', 'ack');
    await registry.connect(owner).setTaxPolicy(await policy.getAddress());
    await policy.connect(owner).acknowledge();
    await policy.connect(employer).acknowledge();
    await policy.connect(agent).acknowledge();
    await token.mint(employer.address, 1000);
    await token.mint(agent.address, 1000);
    await token.connect(agent).approve(await stakeManager.getAddress(), stake);
    await stakeManager.connect(agent).depositStake(0, stake);
    await token
      .connect(employer)
      .approve(await stakeManager.getAddress(), reward);
  });

  it('cannot be canceled at deadline + grace - 1', async () => {
    const deadline = (await time.latest()) + 100;
    const grace = 50;
    await registry.connect(owner).setExpirationGracePeriod(grace);
    const specHash = ethers.id('spec');
    await registry
      .connect(employer)
      .createJob(reward, deadline, specHash, 'uri');
    const jobId = 1;
    await registry.connect(agent).applyForJob(jobId, '', []);
    await time.increase(deadline + grace - 1 - (await time.latest()));
    await expect(
      registry.connect(employer).cancelExpiredJob(jobId)
    ).to.be.revertedWithCustomError(registry, 'DeadlineNotReached');
  });

  it('cancels at deadline + grace and updates state and balances', async () => {
    const deadline = (await time.latest()) + 100;
    const grace = 50;
    await registry.connect(owner).setExpirationGracePeriod(grace);
    const specHash = ethers.id('spec');
    await registry
      .connect(employer)
      .createJob(reward, deadline, specHash, 'uri');
    const jobId = 1;
    await registry.connect(agent).applyForJob(jobId, '', []);
    await time.increase(deadline + grace - (await time.latest()));
    await expect(registry.connect(employer).cancelExpiredJob(jobId))
      .to.emit(registry, 'JobExpired')
      .withArgs(jobId, employer.address)
      .and.to.emit(registry, 'JobFinalized')
      .withArgs(jobId, agent.address);

    expect(await token.balanceOf(employer.address)).to.equal(1200);
    expect(await token.balanceOf(agent.address)).to.equal(800);
    const job = enrichJob(await registry.jobs(jobId));
    expect(job.state).to.equal(6);
    expect(job.success).to.equal(false);
    expect(await stakeManager.stakes(agent.address, 0)).to.equal(0);
  });
});
