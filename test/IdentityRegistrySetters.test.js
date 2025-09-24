const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('IdentityRegistry setters', function () {
  let owner;
  let agent;
  let validator;
  let extra;
  let identity;
  beforeEach(async () => {
    [owner, agent, validator, extra] = await ethers.getSigners();

    const Stake = await ethers.getContractFactory(
      'contracts/mocks/MockV2.sol:MockStakeManager'
    );
    const stake = await Stake.deploy();

    const Rep = await ethers.getContractFactory(
      'contracts/ReputationEngine.sol:ReputationEngine'
    );
    const rep = await Rep.deploy(await stake.getAddress());

    const ENS = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockENS.sol:MockENS'
    );
    const ens = await ENS.deploy();

    const Wrapper = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockNameWrapper.sol:MockNameWrapper'
    );
    const wrapper = await Wrapper.deploy();

    const Identity = await ethers.getContractFactory(
      'contracts/IdentityRegistry.sol:IdentityRegistry'
    );
    identity = await Identity.deploy(
      await ens.getAddress(),
      await wrapper.getAddress(),
      await rep.getAddress(),
      ethers.ZeroHash,
      ethers.ZeroHash
    );
  });

  it('initialises canonical alpha aliases for agents and validators', async () => {
    const alphaAgent = await identity.MAINNET_ALPHA_AGENT_ROOT_NODE();
    const alphaClub = await identity.MAINNET_ALPHA_CLUB_ROOT_NODE();

    const agentAliases = await identity.getAgentRootAliases();
    const clubAliases = await identity.getClubRootAliases();

    expect(agentAliases).to.include(alphaAgent);
    expect(clubAliases).to.include(alphaClub);

    const [agentExists, agentEnabled] = await identity.agentRootAliasInfo(
      alphaAgent
    );
    const [clubExists, clubEnabled] = await identity.clubRootAliasInfo(
      alphaClub
    );

    expect(agentExists).to.equal(true);
    expect(agentEnabled).to.equal(true);
    expect(clubExists).to.equal(true);
    expect(clubEnabled).to.equal(true);
  });

  describe('setENS', function () {
    it('reverts for zero address', async () => {
      await expect(
        identity.setENS(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(identity, 'ZeroAddress');
    });

    it('updates and emits event for valid address', async () => {
      const ENS = await ethers.getContractFactory(
        'contracts/mocks/legacy/MockENS.sol:MockENS'
      );
      const newEns = await ENS.deploy();
      await expect(identity.setENS(await newEns.getAddress()))
        .to.emit(identity, 'ENSUpdated')
        .withArgs(await newEns.getAddress());
      expect(await identity.ens()).to.equal(await newEns.getAddress());
    });
  });

  describe('setNameWrapper', function () {
    it('reverts for zero address', async () => {
      await expect(
        identity.setNameWrapper(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(identity, 'ZeroAddress');
    });

    it('updates and emits event for valid address', async () => {
      const Wrapper = await ethers.getContractFactory(
        'contracts/mocks/legacy/MockNameWrapper.sol:MockNameWrapper'
      );
      const newWrapper = await Wrapper.deploy();
      await expect(identity.setNameWrapper(await newWrapper.getAddress()))
        .to.emit(identity, 'NameWrapperUpdated')
        .withArgs(await newWrapper.getAddress());
      expect(await identity.nameWrapper()).to.equal(
        await newWrapper.getAddress()
      );
    });
  });

  describe('setReputationEngine', function () {
    it('reverts for zero address', async () => {
      await expect(
        identity.setReputationEngine(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(identity, 'ZeroAddress');
    });

    it('updates and emits event for valid address', async () => {
      const Stake = await ethers.getContractFactory(
        'contracts/mocks/MockV2.sol:MockStakeManager'
      );
      const stake = await Stake.deploy();
      const Rep = await ethers.getContractFactory(
        'contracts/ReputationEngine.sol:ReputationEngine'
      );
      const newRep = await Rep.deploy(await stake.getAddress());
      await expect(identity.setReputationEngine(await newRep.getAddress()))
        .to.emit(identity, 'ReputationEngineUpdated')
        .withArgs(await newRep.getAddress());
      expect(await identity.reputationEngine()).to.equal(
        await newRep.getAddress()
      );
    });
  });

  describe('setAttestationRegistry', function () {
    it('reverts for zero address', async () => {
      await expect(
        identity.setAttestationRegistry(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(identity, 'ZeroAddress');
    });

    it('updates and emits event for valid address', async () => {
      const Registry = await ethers.getContractFactory(
        'contracts/AttestationRegistry.sol:AttestationRegistry'
      );
      const newRegistry = await Registry.deploy(
        ethers.ZeroAddress,
        ethers.ZeroAddress
      );
      await expect(
        identity.setAttestationRegistry(await newRegistry.getAddress())
      )
        .to.emit(identity, 'AttestationRegistryUpdated')
        .withArgs(await newRegistry.getAddress());
      expect(await identity.attestationRegistry()).to.equal(
        await newRegistry.getAddress()
      );
    });
  });

  describe('configureMainnet', function () {
    it('sets the NameWrapper to the mainnet address', async () => {
      const mainnetWrapper = await identity.MAINNET_NAME_WRAPPER();
      await identity.configureMainnet();
      expect(await identity.nameWrapper()).to.equal(mainnetWrapper);
    });

    it('activates the canonical alpha aliases', async () => {
      const alphaAgent = await identity.MAINNET_ALPHA_AGENT_ROOT_NODE();
      const alphaClub = await identity.MAINNET_ALPHA_CLUB_ROOT_NODE();
      await identity.configureMainnet();
      expect(await identity.getAgentRootAliases()).to.include(alphaAgent);
      expect(await identity.getClubRootAliases()).to.include(alphaClub);
      const [agentExists, agentEnabled] = await identity.agentRootAliasInfo(
        alphaAgent
      );
      expect(agentExists).to.equal(true);
      expect(agentEnabled).to.equal(true);
      const [clubExists, clubEnabled] = await identity.clubRootAliasInfo(
        alphaClub
      );
      expect(clubExists).to.equal(true);
      expect(clubEnabled).to.equal(true);
    });
  });

  describe('root alias management', function () {
    const aliasNode = ethers.id('alias-root');

    it('allows enabling and disabling agent aliases', async () => {
      const startAgentAliases = await identity.getAgentRootAliases();
      await expect(
        identity.setAgentRootAlias(ethers.ZeroHash, true)
      ).to.be.revertedWithCustomError(identity, 'InvalidRootAlias');

      await identity.setAgentRootAlias(aliasNode, true);
      const agentAliases = await identity.getAgentRootAliases();
      expect(agentAliases).to.include(aliasNode);
      expect(agentAliases).to.include.members(startAgentAliases);
      const [existsEnabled, enabledState] = await identity.agentRootAliasInfo(
        aliasNode
      );
      expect(existsEnabled).to.equal(true);
      expect(enabledState).to.equal(true);

      await identity.setAgentRootAlias(aliasNode, false);
      const aliasesAfterDisable = await identity.getAgentRootAliases();
      expect(aliasesAfterDisable).to.not.include(aliasNode);
      expect(aliasesAfterDisable).to.include.members(startAgentAliases);
      const [exists, enabled] = await identity.agentRootAliasInfo(aliasNode);
      expect(exists).to.equal(true);
      expect(enabled).to.equal(false);
    });

    it('allows batched alias updates with tracking', async () => {
      const clubAlias = ethers.id('club-alias');
      const startAgentAliases = await identity.getAgentRootAliases();
      const startClubAliases = await identity.getClubRootAliases();
      await expect(
        identity.applyAliasConfiguration(
          [
            { root: aliasNode, enabled: true },
            { root: aliasNode, enabled: false },
          ],
          [{ root: clubAlias, enabled: true }]
        )
      )
        .to.emit(identity, 'AliasConfigurationApplied')
        .withArgs(owner.address, 2, 1);
      const agentAliases = await identity.getAgentRootAliases();
      const clubAliases = await identity.getClubRootAliases();
      const [agentExists, agentEnabled] = await identity.agentRootAliasInfo(
        aliasNode
      );
      expect(agentExists).to.equal(true);
      expect(agentEnabled).to.equal(false);
      expect(agentAliases).to.include.members(startAgentAliases);
      expect(agentAliases).to.not.include(aliasNode);
      expect(clubAliases).to.include.members(startClubAliases);
      expect(clubAliases).to.include(clubAlias);
      const [clubExists, clubEnabled] = await identity.clubRootAliasInfo(
        clubAlias
      );
      expect(clubExists).to.equal(true);
      expect(clubEnabled).to.equal(true);
    });
  });

  describe('applyConfiguration', function () {
    it('updates toggled values and allowlists atomically', async () => {
      const ENS = await ethers.getContractFactory(
        'contracts/mocks/legacy/MockENS.sol:MockENS'
      );
      const newEns = await ENS.deploy();

      const Wrapper = await ethers.getContractFactory(
        'contracts/mocks/legacy/MockNameWrapper.sol:MockNameWrapper'
      );
      const newWrapper = await Wrapper.deploy();

      const Stake = await ethers.getContractFactory(
        'contracts/mocks/MockV2.sol:MockStakeManager'
      );
      const stake = await Stake.deploy();

      const Rep = await ethers.getContractFactory(
        'contracts/ReputationEngine.sol:ReputationEngine'
      );
      const newRep = await Rep.deploy(await stake.getAddress());

      const Registry = await ethers.getContractFactory(
        'contracts/AttestationRegistry.sol:AttestationRegistry'
      );
      const attRegistry = await Registry.deploy(
        ethers.ZeroAddress,
        ethers.ZeroAddress
      );

      const config = {
        setENS: true,
        ens: await newEns.getAddress(),
        setNameWrapper: true,
        nameWrapper: await newWrapper.getAddress(),
        setReputationEngine: true,
        reputationEngine: await newRep.getAddress(),
        setAttestationRegistry: true,
        attestationRegistry: await attRegistry.getAddress(),
        setAgentRootNode: true,
        agentRootNode: ethers.keccak256(ethers.toUtf8Bytes('agentRoot')),
        setClubRootNode: true,
        clubRootNode: ethers.keccak256(ethers.toUtf8Bytes('clubRoot')),
        setAgentMerkleRoot: true,
        agentMerkleRoot: ethers.keccak256(ethers.toUtf8Bytes('agentMerkle')),
        setValidatorMerkleRoot: true,
        validatorMerkleRoot: ethers.keccak256(
          ethers.toUtf8Bytes('validatorMerkle')
        ),
      };

      const agentUpdates = [
        { agent: agent.address, allowed: true },
        { agent: extra.address, allowed: false },
      ];
      const validatorUpdates = [
        { validator: validator.address, allowed: true },
      ];
      const agentTypeUpdates = [{ agent: agent.address, agentType: 1 }];

      await expect(
        identity.applyConfiguration(
          config,
          agentUpdates,
          validatorUpdates,
          agentTypeUpdates
        )
      )
        .to.emit(identity, 'ConfigurationApplied')
        .withArgs(
          owner.address,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          BigInt(agentUpdates.length),
          BigInt(validatorUpdates.length),
          BigInt(agentTypeUpdates.length)
        );

      expect(await identity.ens()).to.equal(await newEns.getAddress());
      expect(await identity.nameWrapper()).to.equal(
        await newWrapper.getAddress()
      );
      expect(await identity.reputationEngine()).to.equal(
        await newRep.getAddress()
      );
      expect(await identity.attestationRegistry()).to.equal(
        await attRegistry.getAddress()
      );
      expect(await identity.agentRootNode()).to.equal(config.agentRootNode);
      expect(await identity.clubRootNode()).to.equal(config.clubRootNode);
      expect(await identity.agentMerkleRoot()).to.equal(config.agentMerkleRoot);
      expect(await identity.validatorMerkleRoot()).to.equal(
        config.validatorMerkleRoot
      );
      expect(await identity.additionalAgents(agent.address)).to.equal(true);
      expect(await identity.additionalAgents(extra.address)).to.equal(false);
      expect(await identity.additionalValidators(validator.address)).to.equal(
        true
      );
      expect(await identity.getAgentType(agent.address)).to.equal(1n);
    });

    it('reverts when provided invalid configuration values', async () => {
      await expect(
        identity.applyConfiguration(
          {
            setENS: true,
            ens: ethers.ZeroAddress,
            setNameWrapper: false,
            nameWrapper: ethers.ZeroAddress,
            setReputationEngine: false,
            reputationEngine: ethers.ZeroAddress,
            setAttestationRegistry: false,
            attestationRegistry: ethers.ZeroAddress,
            setAgentRootNode: false,
            agentRootNode: ethers.ZeroHash,
            setClubRootNode: false,
            clubRootNode: ethers.ZeroHash,
            setAgentMerkleRoot: false,
            agentMerkleRoot: ethers.ZeroHash,
            setValidatorMerkleRoot: false,
            validatorMerkleRoot: ethers.ZeroHash,
          },
          [],
          [],
          []
        )
      ).to.be.revertedWithCustomError(identity, 'ZeroAddress');
    });
  });
});
