const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('PlatformIncentives acknowledge', function () {
  it('acknowledgeStakeAndActivate records acknowledgement', async () => {
    const [owner, operator, treasury] = await ethers.getSigners();

    const { AGIALPHA } = require('../scripts/constants');
    const token = await ethers.getContractAt(
      'contracts/test/AGIALPHAToken.sol:AGIALPHAToken',
      AGIALPHA
    );
    await token.mint(owner.address, 1000);
    await token.mint(operator.address, 1000);

    const Stake = await ethers.getContractFactory(
      'contracts/StakeManager.sol:StakeManager'
    );
    const stakeManager = await Stake.deploy(
      0,
      100,
      0,
      treasury.address,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      owner.address
    );
    await stakeManager.connect(owner).setMinStake(1);

    const Rep = await ethers.getContractFactory(
      'contracts/ReputationEngine.sol:ReputationEngine'
    );
    const reputation = await Rep.deploy(await stakeManager.getAddress());
    await reputation.setStakeManager(await stakeManager.getAddress());

    const Registry = await ethers.getContractFactory(
      'contracts/PlatformRegistry.sol:PlatformRegistry'
    );
    const platformRegistry = await Registry.deploy(
      await stakeManager.getAddress(),
      await reputation.getAddress(),
      0
    );

    const Router = await ethers.getContractFactory(
      'contracts/modules/JobRouter.sol:JobRouter'
    );
    const jobRouter = await Router.deploy(await platformRegistry.getAddress());

    const Incentives = await ethers.getContractFactory(
      'contracts/PlatformIncentives.sol:PlatformIncentives'
    );
    const incentives = await Incentives.deploy(
      await stakeManager.getAddress(),
      await platformRegistry.getAddress(),
      await jobRouter.getAddress()
    );
    await platformRegistry.setRegistrar(await incentives.getAddress(), true);
    await jobRouter.setRegistrar(await incentives.getAddress(), true);

    const JobRegistry = await ethers.getContractFactory(
      'contracts/JobRegistry.sol:JobRegistry'
    );
    const jobRegistry = await JobRegistry.deploy(
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
    const policy = await TaxPolicy.deploy('ipfs://policy', 'ack');
    await jobRegistry.connect(owner).setTaxPolicy(await policy.getAddress());
    await policy
      .connect(owner)
      .setAcknowledger(await jobRegistry.getAddress(), true);
    await jobRegistry
      .connect(owner)
      .setAcknowledger(await incentives.getAddress(), true);
    await stakeManager
      .connect(owner)
      .setJobRegistry(await jobRegistry.getAddress());

    const STAKE = 10n ** 18n;
    await token.mint(operator.address, STAKE);
    await token
      .connect(operator)
      .approve(await stakeManager.getAddress(), STAKE);

    await incentives.connect(operator).acknowledgeStakeAndActivate(STAKE);
    expect(await policy.hasAcknowledged(operator.address)).to.equal(true);
  });
});
