const { expect } = require('chai');
const { ethers } = require('hardhat');

// helper constants
const TOKEN = 1000000000000000000n; // 1 token with 18 decimals
const STAKE_ALICE = 200n * TOKEN; // 200 tokens
const STAKE_BOB = 100n * TOKEN; // 100 tokens
const REWARD = 50n * TOKEN; // job reward 50 tokens
const FEE = 300n * TOKEN; // fee 300 tokens
describe('Platform reward flow', function () {
  const { AGIALPHA } = require('../scripts/constants');
  let owner, alice, bob, employer, treasury;
  let token,
    stakeManager,
    jobRegistry,
    platformRegistry,
    jobRouter,
    feePool,
    taxPolicy;

  beforeEach(async () => {
    [owner, alice, bob, employer, treasury] = await ethers.getSigners();

    token = await ethers.getContractAt(
      'contracts/test/AGIALPHAToken.sol:AGIALPHAToken',
      AGIALPHA
    );
    await token.mint(alice.address, 1000n * TOKEN);
    await token.mint(bob.address, 1000n * TOKEN);
    await token.mint(employer.address, 1000n * TOKEN);

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

    const JobRegistry = await ethers.getContractFactory(
      'contracts/JobRegistry.sol:JobRegistry'
    );
    jobRegistry = await JobRegistry.deploy(
      ethers.ZeroAddress,
      await stakeManager.getAddress(),
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      0,
      0,
      [],
      owner.address
    );

    const TaxPolicy = await ethers.getContractFactory(
      'contracts/TaxPolicy.sol:TaxPolicy'
    );
    taxPolicy = await TaxPolicy.deploy('ipfs://policy', 'ack');
    await jobRegistry.connect(owner).setTaxPolicy(await taxPolicy.getAddress());

    await stakeManager
      .connect(owner)
      .setJobRegistry(await jobRegistry.getAddress());

    const Reputation = await ethers.getContractFactory(
      'contracts/ReputationEngine.sol:ReputationEngine'
    );
    const reputation = await Reputation.deploy(await stakeManager.getAddress());

    const PlatformRegistry = await ethers.getContractFactory(
      'contracts/PlatformRegistry.sol:PlatformRegistry'
    );
    platformRegistry = await PlatformRegistry.deploy(
      await stakeManager.getAddress(),
      await reputation.getAddress(),
      0
    );

    const JobRouter = await ethers.getContractFactory(
      'contracts/modules/JobRouter.sol:JobRouter'
    );
    jobRouter = await JobRouter.deploy(await platformRegistry.getAddress());

    const FeePool = await ethers.getContractFactory(
      'contracts/FeePool.sol:FeePool'
    );
    feePool = await FeePool.deploy(
      await stakeManager.getAddress(),
      0,
      ethers.ZeroAddress,
      ethers.ZeroAddress
    );
    await feePool.setBurnPct(0);
  });

  it('handles zero-stake owner and proportional fees', async () => {
    // owner registers with zero stake
    await platformRegistry.connect(owner).register();
    await jobRouter.connect(owner).register();
    expect(await platformRegistry.getScore(owner.address)).to.equal(0n);
    expect(await jobRouter.routingWeight(owner.address)).to.equal(0n);

    // Alice and Bob acknowledge tax policy
    await taxPolicy.connect(alice).acknowledge();
    await taxPolicy.connect(bob).acknowledge();

    // stake and register
    await token
      .connect(alice)
      .approve(await stakeManager.getAddress(), STAKE_ALICE);
    await token
      .connect(bob)
      .approve(await stakeManager.getAddress(), STAKE_BOB);
    await stakeManager.connect(alice).depositStake(2, STAKE_ALICE);
    await stakeManager.connect(bob).depositStake(2, STAKE_BOB);
    await platformRegistry.connect(alice).register();
    await platformRegistry.connect(bob).register();
    await jobRouter.connect(alice).register();
    await jobRouter.connect(bob).register();

    const weightAlice = (STAKE_ALICE * 10n ** 18n) / (STAKE_ALICE + STAKE_BOB);
    const weightBob = (STAKE_BOB * 10n ** 18n) / (STAKE_ALICE + STAKE_BOB);
    expect(await jobRouter.routingWeight(alice.address)).to.equal(weightAlice);
    expect(await jobRouter.routingWeight(bob.address)).to.equal(weightBob);

    // simulate job creation and finalization
    const registryAddr = await jobRegistry.getAddress();
    await ethers.provider.send('hardhat_setBalance', [
      registryAddr,
      '0x1000000000000000000',
    ]);
    const registrySigner = await ethers.getImpersonatedSigner(registryAddr);

    const jobId = ethers.encodeBytes32String('job1');
    await token
      .connect(employer)
      .approve(await stakeManager.getAddress(), REWARD + FEE);
    await stakeManager
      .connect(registrySigner)
      .lockReward(jobId, employer.address, REWARD + FEE);

    const aliceBeforeReward = await token.balanceOf(alice.address);
    await stakeManager
      .connect(registrySigner)
      .finalizeJobFunds(
        jobId,
        registrySigner.address,
        alice.address,
        REWARD,
        0,
        FEE,
        await feePool.getAddress(),
        false
      );
    expect(await token.balanceOf(alice.address)).to.equal(
      aliceBeforeReward + REWARD
    );

    // fee distribution
    await feePool.distributeFees();

    const aliceBefore = await token.balanceOf(alice.address);
    const bobBefore = await token.balanceOf(bob.address);
    const ownerBefore = await token.balanceOf(owner.address);

    await feePool.connect(alice).claimRewards();
    await feePool.connect(bob).claimRewards();
    await feePool.connect(owner).claimRewards();

    expect(await token.balanceOf(alice.address)).to.equal(
      aliceBefore + (STAKE_ALICE * FEE) / (STAKE_ALICE + STAKE_BOB)
    );
    expect(await token.balanceOf(bob.address)).to.equal(
      bobBefore + (STAKE_BOB * FEE) / (STAKE_ALICE + STAKE_BOB)
    );
    expect(await token.balanceOf(owner.address)).to.equal(ownerBefore);
  });
});
