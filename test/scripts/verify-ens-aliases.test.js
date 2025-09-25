const { expect } = require('chai');
const { mkdtempSync, writeFileSync, rmSync } = require('fs');
const { join } = require('path');
const os = require('os');
const { ethers } = require('ethers');

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs' },
});

const { verifyEnsAliases } = require('../../scripts/verify-ens-aliases');

function expectThrow(fn, pattern) {
  try {
    fn();
  } catch (err) {
    expect(err).to.be.instanceOf(Error);
    expect((err && err.message) || '').to.match(pattern);
    return;
  }
  throw new Error('Expected function to throw');
}

function writeFixture({
  agentRoot,
  clubRoot,
  agentAliasNode,
  clubAliasNode,
  aliasLabel = 'alpha',
}) {
  const dir = mkdtempSync(join(os.tmpdir(), 'verify-ens-aliases-'));
  const configPath = join(dir, 'ens.json');
  const identityPath = join(dir, 'IdentityRegistry.sol');

  const agentName = 'agent.agi.eth';
  const clubName = 'club.agi.eth';
  const agentAliasName = `${aliasLabel}.${agentName}`;
  const clubAliasName = `${aliasLabel}.${clubName}`;
  const aliasLabelHash = ethers.keccak256(
    ethers.toUtf8Bytes(aliasLabel.toLowerCase())
  );

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        agent: {
          name: agentName,
          node: agentRoot,
          aliases: [
            {
              name: agentAliasName,
              label: aliasLabel,
              labelhash: aliasLabelHash,
              node: agentAliasNode,
            },
          ],
        },
        club: {
          name: clubName,
          node: clubRoot,
          aliases: [
            {
              name: clubAliasName,
              label: aliasLabel,
              labelhash: aliasLabelHash,
              node: clubAliasNode,
            },
          ],
        },
      },
      null,
      2
    )
  );

  writeFileSync(
    identityPath,
    `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.25;\n\nbytes32 public constant MAINNET_AGENT_ROOT_NODE = ${agentRoot};\nbytes32 public constant MAINNET_CLUB_ROOT_NODE = ${clubRoot};\nbytes32 public constant MAINNET_ALPHA_AGENT_ROOT_NODE = ${agentAliasNode};\nbytes32 public constant MAINNET_ALPHA_CLUB_ROOT_NODE = ${clubAliasNode};\n`
  );

  return { dir, configPath, identityPath };
}

describe('verifyEnsAliases script', () => {
  const agentRoot = ethers.namehash('agent.agi.eth');
  const clubRoot = ethers.namehash('club.agi.eth');
  const agentAliasNode = ethers.namehash('alpha.agent.agi.eth');
  const clubAliasNode = ethers.namehash('alpha.club.agi.eth');

  it('passes when configuration matches identity constants', () => {
    const { dir, configPath, identityPath } = writeFixture({
      agentRoot,
      clubRoot,
      agentAliasNode,
      clubAliasNode,
    });
    try {
      verifyEnsAliases(configPath, identityPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when alias node differs from IdentityRegistry constant', () => {
    const { dir, configPath, identityPath } = writeFixture({
      agentRoot,
      clubRoot,
      agentAliasNode,
      clubAliasNode: ethers.namehash('beta.club.agi.eth'),
    });
    try {
      expectThrow(
        () => verifyEnsAliases(configPath, identityPath),
        /Club alpha alias node/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when alias label is not normalised', () => {
    const { dir, configPath, identityPath } = writeFixture({
      agentRoot,
      clubRoot,
      agentAliasNode,
      clubAliasNode,
      aliasLabel: 'Alpha',
    });
    const config = JSON.parse(require('fs').readFileSync(configPath, 'utf8'));
    config.agent.aliases[0].labelhash = ethers.hexlify(ethers.randomBytes(32));
    config.club.aliases[0].labelhash = config.agent.aliases[0].labelhash;
    require('fs').writeFileSync(configPath, JSON.stringify(config, null, 2));
    try {
      expectThrow(
        () => verifyEnsAliases(configPath, identityPath),
        /labelhash mismatch/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
