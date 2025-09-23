const fs = require('fs');
const path = require('path');
const { keccak256, toChecksumAddress } = require('web3-utils');
const { loadTokenConfig } = require('../scripts/config');

const AGIALPHAToken = artifacts.require('AGIALPHAToken');

function getProvider(web3) {
  const provider = web3.currentProvider;
  if (!provider) {
    throw new Error('Missing web3 provider');
  }
  return provider;
}

async function send(provider, method, params) {
  if (provider.request) {
    return provider.request({ method, params });
  }
  return new Promise((resolve, reject) => {
    provider.send(
      { jsonrpc: '2.0', id: Date.now(), method, params },
      (err, result) => {
        if (err) return reject(err);
        if (result && result.error) return reject(result.error);
        resolve(result ? result.result : null);
      }
    );
  });
}

function padToBytes32(value) {
  if (typeof value === 'number') {
    value = value.toString(16);
  }
  if (typeof value === 'bigint') {
    value = value.toString(16);
  }
  if (typeof value === 'string' && value.startsWith('0x')) {
    value = value.slice(2);
  }
  return `0x${value.toString().padStart(64, '0')}`;
}

function computeMappingSlot(address, slot) {
  const paddedKey = padToBytes32(address.toLowerCase());
  const paddedSlot = padToBytes32(slot);
  return keccak256(paddedKey + paddedSlot.slice(2));
}

module.exports = async function (deployer, network, accounts) {
  const lower = (network || '').toLowerCase();
  if (!['development', 'test', 'coverage'].includes(lower)) {
    return;
  }

  const provider = getProvider(web3);
  const { config } = loadTokenConfig({ network });
  const agialpha = toChecksumAddress(config.address);

  const artifact = AGIALPHAToken || {};
  const json = artifact._json || {};
  const bytecode =
    artifact.deployedBytecode || json.deployedBytecode || artifact.bytecode;
  if (!bytecode || bytecode.length === 0) {
    throw new Error('AGIALPHAToken deployed bytecode unavailable');
  }

  await send(provider, 'evm_setAccountCode', [agialpha, bytecode]);

  const owner = toChecksumAddress(accounts[0]);
  const ownerSlot = padToBytes32(5);
  await send(provider, 'evm_setAccountStorageAt', [
    agialpha,
    ownerSlot,
    padToBytes32(owner),
  ]);

  const ackSlot = computeMappingSlot(owner, 6);
  await send(provider, 'evm_setAccountStorageAt', [
    agialpha,
    ackSlot,
    padToBytes32(1),
  ]);

  const token = await AGIALPHAToken.at(agialpha);
  const mintAmount = web3.utils.toWei('100000');
  for (const account of accounts.slice(0, 10)) {
    await token.mint(account, mintAmount, { from: owner });
  }

  const outPath = path.join(
    __dirname,
    '..',
    'deployment-config',
    'local.token.address'
  );
  fs.writeFileSync(outPath, agialpha);
};
