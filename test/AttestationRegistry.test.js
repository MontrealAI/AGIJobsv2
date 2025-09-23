const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('AttestationRegistry', function () {
  it('allows ENS name owner to attest and revoke', async () => {
    const [owner, agent, other] = await ethers.getSigners();

    const ENS = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockENS.sol:MockENS'
    );
    const ens = await ENS.deploy();

    const Wrapper = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockNameWrapper.sol:MockNameWrapper'
    );
    const wrapper = await Wrapper.deploy();

    const Registry = await ethers.getContractFactory(
      'contracts/AttestationRegistry.sol:AttestationRegistry'
    );
    const registry = await Registry.deploy(
      await ens.getAddress(),
      await wrapper.getAddress()
    );

    const label = 'alice';
    const node = ethers.keccak256(
      ethers.solidityPacked(
        ['bytes32', 'bytes32'],
        [ethers.ZeroHash, ethers.id(label)]
      )
    );
    await wrapper.setOwner(BigInt(node), owner.address);

    await expect(registry.connect(owner).attest(node, 0, agent.address))
      .to.emit(registry, 'Attested')
      .withArgs(node, 0, agent.address, owner.address);
    expect(await registry.isAttested(node, 0, agent.address)).to.equal(true);

    await expect(
      registry.connect(other).attest(node, 0, other.address)
    ).to.be.revertedWithCustomError(registry, 'UnauthorizedAttestor');

    await registry.connect(owner).revoke(node, 0, agent.address);
    expect(await registry.isAttested(node, 0, agent.address)).to.equal(false);
  });

  it('reverts when attesting to the zero address', async () => {
    const [owner] = await ethers.getSigners();

    const ENS = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockENS.sol:MockENS'
    );
    const ens = await ENS.deploy();

    const Wrapper = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockNameWrapper.sol:MockNameWrapper'
    );
    const wrapper = await Wrapper.deploy();

    const Registry = await ethers.getContractFactory(
      'contracts/AttestationRegistry.sol:AttestationRegistry'
    );
    const registry = await Registry.deploy(
      await ens.getAddress(),
      await wrapper.getAddress()
    );

    const label = 'alice';
    const node = ethers.keccak256(
      ethers.solidityPacked(
        ['bytes32', 'bytes32'],
        [ethers.ZeroHash, ethers.id(label)]
      )
    );
    await wrapper.setOwner(BigInt(node), owner.address);

    await expect(
      registry.connect(owner).attest(node, 0, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(registry, 'ZeroAddress');
  });

  it('integrates with IdentityRegistry', async () => {
    const [owner, agent, validator] = await ethers.getSigners();

    const ENS = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockENS.sol:MockENS'
    );
    const ens = await ENS.deploy();

    const Wrapper = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockNameWrapper.sol:MockNameWrapper'
    );
    const wrapper = await Wrapper.deploy();

    const Attest = await ethers.getContractFactory(
      'contracts/AttestationRegistry.sol:AttestationRegistry'
    );
    const attest = await Attest.deploy(
      await ens.getAddress(),
      await wrapper.getAddress()
    );

    const Identity = await ethers.getContractFactory(
      'contracts/IdentityRegistry.sol:IdentityRegistry'
    );
    const identity = await Identity.deploy(
      await ens.getAddress(),
      await wrapper.getAddress(),
      ethers.ZeroAddress,
      ethers.ZeroHash,
      ethers.ZeroHash
    );
    await identity.setAttestationRegistry(await attest.getAddress());

    const agentLabel = 'agent';
    const agentNode = ethers.keccak256(
      ethers.solidityPacked(
        ['bytes32', 'bytes32'],
        [ethers.ZeroHash, ethers.id(agentLabel)]
      )
    );
    await wrapper.setOwner(BigInt(agentNode), owner.address);
    await attest.connect(owner).attest(agentNode, 0, agent.address);

    expect(
      await identity.isAuthorizedAgent.staticCall(agent.address, agentLabel, [])
    ).to.equal(true);

    const validatorLabel = 'validator';
    const validatorNode = ethers.keccak256(
      ethers.solidityPacked(
        ['bytes32', 'bytes32'],
        [ethers.ZeroHash, ethers.id(validatorLabel)]
      )
    );
    await wrapper.setOwner(BigInt(validatorNode), owner.address);
    await attest.connect(owner).attest(validatorNode, 1, validator.address);

    expect(
      await identity.isAuthorizedValidator.staticCall(
        validator.address,
        validatorLabel,
        []
      )
    ).to.equal(true);
  });

  it('restricts set functions to owner', async () => {
    const [owner, other] = await ethers.getSigners();

    const ENS = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockENS.sol:MockENS'
    );
    const ens = await ENS.deploy();

    const Wrapper = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockNameWrapper.sol:MockNameWrapper'
    );
    const wrapper = await Wrapper.deploy();

    const Registry = await ethers.getContractFactory(
      'contracts/AttestationRegistry.sol:AttestationRegistry'
    );
    const registry = await Registry.deploy(
      await ens.getAddress(),
      await wrapper.getAddress()
    );

    await expect(
      registry.connect(other).setENS(other.address)
    ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');

    await expect(
      registry.connect(other).setNameWrapper(other.address)
    ).to.be.revertedWithCustomError(registry, 'OwnableUnauthorizedAccount');

    await expect(registry.connect(owner).setENS(await ens.getAddress()))
      .to.emit(registry, 'ENSUpdated')
      .withArgs(await ens.getAddress());
    await expect(
      registry.connect(owner).setNameWrapper(await wrapper.getAddress())
    )
      .to.emit(registry, 'NameWrapperUpdated')
      .withArgs(await wrapper.getAddress());
  });
});
