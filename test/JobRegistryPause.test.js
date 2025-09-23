const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('JobRegistry pause', function () {
  let owner, employer, agent, registry, identity;

  beforeEach(async () => {
    [owner, employer, agent] = await ethers.getSigners();
    const Identity = await ethers.getContractFactory(
      'contracts/mocks/IdentityRegistryMock.sol:IdentityRegistryMock'
    );
    identity = await Identity.deploy();
    const Registry = await ethers.getContractFactory(
      'contracts/JobRegistry.sol:JobRegistry'
    );
    registry = await Registry.deploy(
      ethers.ZeroAddress,
      ethers.ZeroAddress,
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
    await registry
      .connect(owner)
      .setIdentityRegistry(await identity.getAddress());
    await registry.connect(owner).setJobParameters(0, 0);
  });

  it('restricts pause and unpause to governance or pauser', async () => {
    await expect(
      registry.connect(employer).pause()
    ).to.be.revertedWithCustomError(registry, 'NotGovernanceOrPauser');

    await registry.connect(owner).pause();

    await expect(
      registry.connect(employer).unpause()
    ).to.be.revertedWithCustomError(registry, 'NotGovernanceOrPauser');
  });

  it('pauses job creation and applications', async () => {
    const deadline = (await time.latest()) + 100;
    const specHash = ethers.id('spec');

    await registry.connect(owner).pause();
    await expect(
      registry.connect(employer).createJob(1, deadline, specHash, 'uri')
    ).to.be.revertedWithCustomError(registry, 'EnforcedPause');

    await registry.connect(owner).unpause();
    await registry.connect(employer).createJob(1, deadline, specHash, 'uri');

    await registry.connect(owner).pause();
    await expect(
      registry.connect(agent).applyForJob(1, '', [])
    ).to.be.revertedWithCustomError(registry, 'EnforcedPause');

    await registry.connect(owner).unpause();
    await expect(registry.connect(agent).applyForJob(1, '', []))
      .to.emit(registry, 'AgentIdentityVerified')
      .withArgs(agent.address, ethers.ZeroHash, '', false, false)
      .and.to.emit(registry, 'ApplicationSubmitted')
      .withArgs(1, agent.address, '')
      .and.to.emit(registry, 'AgentAssigned')
      .withArgs(1, agent.address, '');
  });

  it('pauses job expiration', async () => {
    const deadline = (await time.latest()) + 100;
    const specHash = ethers.id('spec');

    await registry.connect(employer).createJob(1, deadline, specHash, 'uri');
    await registry.connect(agent).applyForJob(1, '', []);

    await time.increase(200);

    await registry.connect(owner).pause();
    await expect(
      registry.connect(owner).cancelExpiredJob(1)
    ).to.be.revertedWithCustomError(registry, 'EnforcedPause');

    await registry.connect(owner).unpause();
    await expect(registry.connect(owner).cancelExpiredJob(1))
      .to.emit(registry, 'JobExpired')
      .withArgs(1, owner.address);
  });
});
