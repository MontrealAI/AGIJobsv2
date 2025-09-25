import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import { inferNetworkKey, loadEnsConfig } from './config';

const DEFAULT_IDENTITY_PATH = path.join(
  __dirname,
  '..',
  'contracts',
  'IdentityRegistry.sol'
);

const DEFAULT_CONFIG_PATH = loadEnsConfig({ persist: false }).path;

type EnsAlias = {
  name: string;
  label: string;
  labelhash?: string;
  node: string;
};

type EnsRoot = {
  name: string;
  node: string;
  aliases?: EnsAlias[];
};

type IdentityConstants = {
  agentRoot: string;
  clubRoot: string;
  alphaAgentRoot: string;
  alphaClubRoot: string;
};

type VerifyOptions = {
  expectedLabel?: string;
};

function assertBytes32(value: string, label: string): string {
  if (!value || typeof value !== 'string') {
    throw new Error(`${label} is required`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  if (!ethers.isHexString(trimmed, 32)) {
    throw new Error(`${label} must be a 32-byte hex string`);
  }
  return ethers.hexlify(trimmed);
}

function readEnsConfig(configPath: string): Record<string, EnsRoot> {
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const result: Record<string, EnsRoot> = {};

  const maybeRoots = (parsed.roots as Record<string, unknown>) || {};
  for (const key of ['agent', 'club', 'business']) {
    const rootEntry = (parsed as Record<string, unknown>)[key];
    if (rootEntry && typeof rootEntry === 'object') {
      result[key] = rootEntry as EnsRoot;
    }
  }
  for (const [key, value] of Object.entries(maybeRoots)) {
    if (!result[key] && value && typeof value === 'object') {
      result[key] = value as EnsRoot;
    }
  }

  return result;
}

function parseIdentityConstants(source: string): IdentityConstants {
  const extract = (name: string) => {
    const pattern = new RegExp(
      `bytes32\\s+public\\s+constant\\s+${name}\\s*=\\s*(0x[0-9a-fA-F]{64});`
    );
    const match = source.match(pattern);
    if (!match) {
      throw new Error(`Unable to locate ${name} in IdentityRegistry.sol`);
    }
    return assertBytes32(match[1], name);
  };

  return {
    agentRoot: extract('MAINNET_AGENT_ROOT_NODE'),
    clubRoot: extract('MAINNET_CLUB_ROOT_NODE'),
    alphaAgentRoot: extract('MAINNET_ALPHA_AGENT_ROOT_NODE'),
    alphaClubRoot: extract('MAINNET_ALPHA_CLUB_ROOT_NODE'),
  };
}

function ensureNamehash(name: string, expected: string, label: string): void {
  const normalised = ethers.namehash(name);
  if (normalised.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `${label} mismatch: config has ${expected}, but computed namehash(${name}) = ${normalised}`
    );
  }
}

function ensureLabelHash(label: string, expected?: string): void {
  if (!label) {
    throw new Error('Alias label is missing');
  }
  const computed = ethers.keccak256(ethers.toUtf8Bytes(label.toLowerCase()));
  if (expected && computed.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `Alias labelhash mismatch: expected ${expected}, got ${computed}`
    );
  }
}

function pickAlias(root: EnsRoot, expectedLabel: string): EnsAlias {
  const aliases = Array.isArray(root.aliases) ? root.aliases : [];
  if (!aliases.length) {
    throw new Error(
      `No aliases configured for ${root.name || 'unknown ENS root'}`
    );
  }
  const alias = aliases.find(
    (entry) => entry.label?.toLowerCase() === expectedLabel.toLowerCase()
  );
  if (!alias) {
    throw new Error(
      `Expected alias with label "${expectedLabel}" for ${root.name}, but none was found`
    );
  }
  return alias;
}

export function verifyEnsAliases(
  configPath: string = DEFAULT_CONFIG_PATH,
  identityPath: string = DEFAULT_IDENTITY_PATH,
  options: VerifyOptions = {}
): void {
  const expectedLabel = (options.expectedLabel || 'alpha').toLowerCase();
  const config = readEnsConfig(configPath);
  const identitySource = fs.readFileSync(identityPath, 'utf8');
  const constants = parseIdentityConstants(identitySource);

  const agent = config.agent || config['agent'];
  const club = config.club || config['club'];

  if (!agent || !agent.name || !agent.node) {
    throw new Error('Agent ENS configuration is incomplete');
  }
  if (!club || !club.name || !club.node) {
    throw new Error('Club ENS configuration is incomplete');
  }

  const agentNode = assertBytes32(agent.node, 'Agent root node');
  const clubNode = assertBytes32(club.node, 'Club root node');

  ensureNamehash(agent.name, agentNode, 'Agent root node');
  ensureNamehash(club.name, clubNode, 'Club root node');

  if (agentNode.toLowerCase() !== constants.agentRoot.toLowerCase()) {
    throw new Error(
      `IdentityRegistry MAINNET_AGENT_ROOT_NODE (${constants.agentRoot}) does not match config (${agentNode})`
    );
  }
  if (clubNode.toLowerCase() !== constants.clubRoot.toLowerCase()) {
    throw new Error(
      `IdentityRegistry MAINNET_CLUB_ROOT_NODE (${constants.clubRoot}) does not match config (${clubNode})`
    );
  }

  const agentAlias = pickAlias(agent, expectedLabel);
  const clubAlias = pickAlias(club, expectedLabel);

  ensureLabelHash(agentAlias.label, agentAlias.labelhash);
  ensureLabelHash(clubAlias.label, clubAlias.labelhash);

  const agentAliasNode = assertBytes32(
    agentAlias.node,
    'Agent alpha alias node'
  );
  const clubAliasNode = assertBytes32(clubAlias.node, 'Club alpha alias node');

  ensureNamehash(agentAlias.name, agentAliasNode, 'Agent alpha alias node');
  ensureNamehash(clubAlias.name, clubAliasNode, 'Club alpha alias node');

  const expectedAgentAliasName = `${expectedLabel}.${agent.name}`;
  if (agentAlias.name.toLowerCase() !== expectedAgentAliasName.toLowerCase()) {
    throw new Error(
      `Agent alpha alias name should be ${expectedAgentAliasName}, got ${agentAlias.name}`
    );
  }
  const expectedClubAliasName = `${expectedLabel}.${club.name}`;
  if (clubAlias.name.toLowerCase() !== expectedClubAliasName.toLowerCase()) {
    throw new Error(
      `Club alpha alias name should be ${expectedClubAliasName}, got ${clubAlias.name}`
    );
  }

  if (agentAliasNode.toLowerCase() !== constants.alphaAgentRoot.toLowerCase()) {
    throw new Error(
      `IdentityRegistry MAINNET_ALPHA_AGENT_ROOT_NODE (${constants.alphaAgentRoot}) does not match config (${agentAliasNode})`
    );
  }
  if (clubAliasNode.toLowerCase() !== constants.alphaClubRoot.toLowerCase()) {
    throw new Error(
      `IdentityRegistry MAINNET_ALPHA_CLUB_ROOT_NODE (${constants.alphaClubRoot}) does not match config (${clubAliasNode})`
    );
  }
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    let configPath = DEFAULT_CONFIG_PATH;
    let identityPath = DEFAULT_IDENTITY_PATH;
    let expectedLabel = 'alpha';
    let networkArg: string | undefined;
    let configOverride = false;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--config' && i + 1 < args.length) {
        configPath = args[++i];
        configOverride = true;
      } else if (arg === '--identity' && i + 1 < args.length) {
        identityPath = args[++i];
      } else if (arg === '--label' && i + 1 < args.length) {
        expectedLabel = args[++i];
      } else if (arg === '--network' && i + 1 < args.length) {
        networkArg = args[++i];
      } else if (arg.startsWith('--network=')) {
        networkArg = arg.slice('--network='.length);
      } else if (arg.startsWith('--config=')) {
        configPath = arg.slice('--config='.length);
        configOverride = true;
      } else if (arg.startsWith('--identity=')) {
        identityPath = arg.slice('--identity='.length);
      } else if (arg.startsWith('--label=')) {
        expectedLabel = arg.slice('--label='.length);
      } else {
        console.warn(`Unrecognized argument: ${arg}`);
      }
    }

    if (!configOverride && networkArg) {
      const inferred = inferNetworkKey(networkArg) ?? networkArg;
      const { path: networkPath } = loadEnsConfig({
        network: inferred,
        persist: false,
      });
      configPath = networkPath;
    }

    try {
      verifyEnsAliases(configPath, identityPath, {
        expectedLabel,
      });
      console.log(
        'ENS configuration matches IdentityRegistry alpha alias constants.'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(message);
      process.exit(1);
    }
  })();
}
