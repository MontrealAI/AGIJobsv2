const StakeManager = artifacts.require('StakeManager');
const JobRegistry = artifacts.require('JobRegistry');
const ValidationModule = artifacts.require('ValidationModule');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const TaxPolicy = artifacts.require('TaxPolicy');
const AGIALPHAToken = artifacts.require('AGIALPHAToken');

const { AGIALPHA } = require('../../scripts/constants');

function send(method, params = []) {
  const provider = web3.currentProvider;
  if (provider.request) {
    return provider.request({ method, params });
  }
  return new Promise((resolve, reject) => {
    provider.send(
      { jsonrpc: '2.0', id: Date.now(), method, params },
      (err, res) => {
        if (err) return reject(err);
        if (res && res.error) return reject(res.error);
        resolve(res ? res.result : null);
      }
    );
  });
}

async function increaseTime(seconds) {
  await send('evm_increaseTime', [seconds]);
  await send('evm_mine');
}

const toBN = (value) => web3.utils.toBN(value);

contract('Happy path lifecycle', (accounts) => {
  const [owner, employer, agent, validatorA, validatorB, validatorC] = accounts;
  const validators = [validatorA, validatorB, validatorC];

  it('covers create -> apply -> commit -> reveal -> finalize', async () => {
    const token = await AGIALPHAToken.at(AGIALPHA);
    const stake = await StakeManager.deployed();
    const job = await JobRegistry.deployed();
    const validation = await ValidationModule.deployed();
    const identity = await IdentityRegistry.deployed();
    const taxPolicy = await TaxPolicy.deployed();

    await token.mint(stake.address, 0, { from: owner });

    await validation.setValidatorPool(validators, { from: owner });
    await validation.setValidatorsPerJob(validators.length, { from: owner });

    await identity.addAdditionalAgent(agent, { from: owner });
    for (const val of validators) {
      await identity.addAdditionalValidator(val, { from: owner });
    }

    await taxPolicy.acknowledge({ from: employer });
    await taxPolicy.acknowledge({ from: agent });
    for (const val of validators) {
      await taxPolicy.acknowledge({ from: val });
    }

    const reward = toBN(web3.utils.toWei('100'));
    const feePct = toBN(await job.feePct());
    const fee = reward.mul(feePct).div(toBN('100'));
    const totalFunding = reward.add(fee);

    await token.approve(stake.address, totalFunding, { from: employer });
    const latest = await web3.eth.getBlock('latest');
    const deadline = latest.timestamp + 7200;
    const specHash = web3.utils.soliditySha3('spec');
    const uri = 'ipfs://job';
    const createTx = await job.createJob(reward, deadline, specHash, uri, {
      from: employer,
    });
    const createLog = createTx.logs.find((log) => log.event === 'JobCreated');
    assert(createLog, 'JobCreated event not emitted');
    const jobId = createLog.args.jobId.toNumber();

    const agentStake = toBN(await stake.minStake());
    await token.approve(stake.address, agentStake, { from: agent });
    await stake.depositStake(0, agentStake, { from: agent });

    const validatorStake = toBN(await stake.minStake());
    for (const val of validators) {
      await token.approve(stake.address, validatorStake, { from: val });
      await stake.depositStake(1, validatorStake, { from: val });
    }

    await job.applyForJob(jobId, 'agent', [], { from: agent });

    const resultHash = web3.utils.soliditySha3('result');
    await job.submit(jobId, resultHash, 'ipfs://result', 'agent', [], {
      from: agent,
    });

    await validation.selectValidators(jobId, 1, { from: owner });
    await send('evm_mine');
    await validation.selectValidators(jobId, 2, { from: employer });

    const selected = await validation.validators(jobId);
    assert.equal(selected.length, validators.length, 'validator count');
    for (const val of validators) {
      assert(selected.includes(val), 'validator chosen');
    }

    const nonce = await validation.jobNonce(jobId);
    const chainId = await web3.eth.getChainId();
    const burnTxHash = '0x' + '0'.repeat(64);
    const spec = await job.getSpecHash(jobId);
    const domain = await validation.DOMAIN_SEPARATOR();

    const commitments = validators.map((val) => {
      const salt = web3.utils.randomHex(32);
      const outcomeHash = web3.utils.keccak256(
        web3.eth.abi.encodeParameters(
          ['uint256', 'bytes32', 'bool', 'bytes32'],
          [nonce.toString(), spec, true, burnTxHash]
        )
      );
      const commitHash = web3.utils.keccak256(
        web3.eth.abi.encodeParameters(
          ['uint256', 'bytes32', 'bytes32', 'address', 'uint256', 'bytes32'],
          [jobId.toString(), outcomeHash, salt, val, chainId.toString(), domain]
        )
      );
      return { validator: val, salt, commitHash };
    });

    for (const entry of commitments) {
      await validation.commitValidation(
        jobId,
        entry.commitHash,
        'validator',
        [],
        { from: entry.validator }
      );
    }

    const commitWindow = Number(await validation.commitWindow());
    await increaseTime(commitWindow + 1);

    for (const entry of commitments) {
      await validation.revealValidation(
        jobId,
        true,
        burnTxHash,
        entry.salt,
        'validator',
        [],
        { from: entry.validator }
      );
    }

    const expected = await validation.finalize.call(jobId, { from: employer });
    assert.equal(expected, true, 'validation finalized');
    await validation.finalize(jobId, { from: employer });

    const before = toBN(await token.balanceOf(agent));
    await job.finalize(jobId, { from: employer });
    const after = toBN(await token.balanceOf(agent));
    assert(after.gt(before), 'agent received payout');
  });
});
