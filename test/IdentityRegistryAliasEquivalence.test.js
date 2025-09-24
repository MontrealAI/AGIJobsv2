const { expect } = require('chai');
const { ethers } = require('hardhat');

const ALIAS_LABEL = 'alpha-proof';
const VALIDATOR_LABEL = 'committee-alpha';

describe('IdentityRegistry canonical alias equivalence', function () {
  let owner;
  let agent;
  let validator;
  let identity;
  let wrapper;
  let ens;

  beforeEach(async function () {
    [owner, agent, validator] = await ethers.getSigners();

    const ENS = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockENS.sol:MockENS'
    );
    ens = await ENS.deploy();

    const Wrapper = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockNameWrapper.sol:MockNameWrapper'
    );
    wrapper = await Wrapper.deploy();

    const Identity = await ethers.getContractFactory(
      'contracts/IdentityRegistry.sol:IdentityRegistry'
    );
    identity = await Identity.deploy(
      await ens.getAddress(),
      await wrapper.getAddress(),
      ethers.ZeroAddress,
      ethers.ZeroHash,
      ethers.ZeroHash
    );
  });

  function computeAliasNode(root, label) {
    const labelHash = ethers.id(label);
    return ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'bytes32'], [root, labelHash])
    );
  }

  it('treats *.alpha.agent.agi.eth as equivalent to the agent root', async function () {
    const mainRoot = await identity.MAINNET_AGENT_ROOT_NODE();
    const alphaRoot = await identity.MAINNET_ALPHA_AGENT_ROOT_NODE();

    await identity.setAgentRootNode(mainRoot);

    const aliasNode = computeAliasNode(alphaRoot, ALIAS_LABEL);
    await wrapper.setOwner(ethers.toBigInt(aliasNode), agent.address);

    const authorized = await identity.isAuthorizedAgent(
      agent.address,
      ALIAS_LABEL,
      []
    );

    expect(authorized).to.equal(true);
  });

  it('treats *.alpha.club.agi.eth as equivalent to the validator root', async function () {
    const mainRoot = await identity.MAINNET_CLUB_ROOT_NODE();
    const alphaRoot = await identity.MAINNET_ALPHA_CLUB_ROOT_NODE();

    await identity.setClubRootNode(mainRoot);

    const aliasNode = computeAliasNode(alphaRoot, VALIDATOR_LABEL);
    await wrapper.setOwner(ethers.toBigInt(aliasNode), validator.address);

    const authorized = await identity.isAuthorizedValidator(
      validator.address,
      VALIDATOR_LABEL,
      []
    );

    expect(authorized).to.equal(true);
  });
});
