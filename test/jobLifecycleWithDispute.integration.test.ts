import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { AGIALPHA_DECIMALS } from '../scripts/constants';
import { decodeJobMetadata } from './utils/jobMetadata';

enum Role {
  Agent,
  Validator,
  Platform,
}

async function deployFullSystem() {
  const [owner, employer, agent, v1, v2, moderator] = await ethers.getSigners();

  const Token = await ethers.getContractFactory(
    'contracts/test/AGIALPHAToken.sol:AGIALPHAToken'
  );
  const token = await Token.deploy();
  const mint = ethers.parseUnits('1000', AGIALPHA_DECIMALS);
  await token.mint(employer.address, mint);
  await token.mint(agent.address, mint);
  await token.mint(v1.address, mint);
  await token.mint(v2.address, mint);

  const Stake = await ethers.getContractFactory(
    'contracts/StakeManager.sol:StakeManager'
  );
  const stake = await Stake.deploy(
    await token.getAddress(),
    0,
    0,
    0,
    owner.address,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    owner.address
  );

  const Reputation = await ethers.getContractFactory(
    'contracts/ReputationEngine.sol:ReputationEngine'
  );
  const reputation = await Reputation.deploy(await stake.getAddress());

  const Identity = await ethers.getContractFactory(
    'contracts/mocks/IdentityRegistryToggle.sol:IdentityRegistryToggle'
  );
  const identity = await Identity.deploy();
  await identity.setResult(true);

  const Validation = await ethers.getContractFactory(
    'contracts/ValidationModule.sol:ValidationModule'
  );
  const validation = await Validation.deploy(
    ethers.ZeroAddress,
    await stake.getAddress(),
    1,
    1,
    1,
    5,
    []
  );

  const NFT = await ethers.getContractFactory(
    'contracts/CertificateNFT.sol:CertificateNFT'
  );
  const nft = await NFT.deploy('Cert', 'CERT');

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

  const Dispute = await ethers.getContractFactory(
    'contracts/modules/DisputeModule.sol:DisputeModule'
  );
  const dispute = await Dispute.deploy(
    await registry.getAddress(),
    0,
    0,
    moderator.address
  );
  await dispute.waitForDeployment();
  await dispute.setStakeManager(await stake.getAddress());

  await stake.setModules(
    await registry.getAddress(),
    await dispute.getAddress()
  );
  await validation.setJobRegistry(await registry.getAddress());
  await validation.setIdentityRegistry(await identity.getAddress());
  await validation.setValidatorPool([v1.address, v2.address]);
  await validation.setValidatorsPerJob(2);
  await registry.setModules(
    await validation.getAddress(),
    await stake.getAddress(),
    await reputation.getAddress(),
    await dispute.getAddress(),
    await nft.getAddress(),
    ethers.ZeroAddress,
    []
  );
  await reputation.setCaller(await registry.getAddress(), true);

  return {
    owner,
    employer,
    agent,
    v1,
    v2,
    moderator,
    token,
    stake,
    validation,
    registry,
    dispute,
  };
}

describe('job lifecycle with dispute and validator failure', function () {
  it('handles validator non-participation and dispute resolution', async () => {
    const env = await deployFullSystem();
    const {
      employer,
      agent,
      v1,
      v2,
      token,
      stake,
      validation,
      registry,
      dispute,
      moderator,
    } = env;

    const stakeAmount = ethers.parseUnits('1', AGIALPHA_DECIMALS);
    for (const signer of [agent, v1, v2]) {
      await token
        .connect(signer)
        .approve(await stake.getAddress(), stakeAmount);
      const role = signer === agent ? Role.Agent : Role.Validator;
      await stake.connect(signer).depositStake(role, stakeAmount);
    }
    const initialAgentBalance = await token.balanceOf(agent.address);

    const reward = ethers.parseUnits('100', AGIALPHA_DECIMALS);
    const feePct = await registry.feePct();
    const fee = (reward * feePct) / 100n;
    await token
      .connect(employer)
      .approve(await stake.getAddress(), reward + fee);
    const deadline = BigInt((await time.latest()) + 3600);
    const specHash = ethers.id('spec');
    await registry
      .connect(employer)
      .createJob(reward, deadline, specHash, 'ipfs://job');

    await registry.connect(agent).applyForJob(1, 'agent', []);
    await registry
      .connect(agent)
      .submit(1, ethers.id('ipfs://result'), 'ipfs://result', 'agent', []);
    const burnTxHash = ethers.keccak256(ethers.toUtf8Bytes('burn'));
    await registry.connect(employer).submitBurnReceipt(1, burnTxHash, 0, 0);
    await registry.connect(employer).confirmEmployerBurn(1, burnTxHash);

    const nonce = await validation.jobNonce(1);
    const salt1 = ethers.randomBytes(32);
    const commit1 = ethers.keccak256(
      ethers.solidityPacked(
        ['uint256', 'uint256', 'bool', 'bytes32', 'bytes32', 'bytes32'],
        [1n, nonce, true, burnTxHash, salt1, specHash]
      )
    );
    await validation.connect(v1).commitValidation(1, commit1, '', []);
    const salt2 = ethers.randomBytes(32);
    const commit2 = ethers.keccak256(
      ethers.solidityPacked(
        ['uint256', 'uint256', 'bool', 'bytes32', 'bytes32', 'bytes32'],
        [1n, nonce, false, burnTxHash, salt2, specHash]
      )
    );
    await validation.connect(v2).commitValidation(1, commit2, '', []);

    await time.increase(2);
    await validation
      .connect(v1)
      .revealValidation(1, true, burnTxHash, salt1, '', []);
    // v2 fails to reveal
    await time.increase(2);
    await validation.finalize(1);

    expect(await stake.stakes(v2.address, Role.Validator)).to.be.lt(
      stakeAmount
    );
    {
      const job = await registry.jobs(1);
      const metadata = decodeJobMetadata(job.packedMetadata);
      expect(metadata.state).to.equal(5); // Disputed
    }

    await registry
      .connect(agent)
      .dispute(1, ethers.id('evidence'), 'ipfs://evidence');
    const hash = ethers.solidityPackedKeccak256(
      ['address', 'uint256', 'bool'],
      [await dispute.getAddress(), 1, false]
    );
    const sig = await owner.signMessage(ethers.getBytes(hash));
    await dispute.connect(owner).resolveDispute(1, false);
    await registry.connect(employer).finalize(1);

    {
      const job = await registry.jobs(1);
      const metadata = decodeJobMetadata(job.packedMetadata);
      expect(metadata.state).to.equal(6); // Finalized
    }
    expect(await token.balanceOf(agent.address)).to.be.gt(initialAgentBalance);
  });
});
