import { ethers } from 'hardhat';
import type { ContractTransactionResponse } from 'ethers';

type AliasUpdate = { root: string; enabled: boolean };

function requireAddress(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`${label} env var required`);
  }
  try {
    return ethers.getAddress(value);
  } catch (err) {
    throw new Error(`${label} must be a valid address`);
  }
}

function parseNode(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`${label} env var required`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} env var required`);
  }
  if (ethers.isHexString(trimmed, 32)) {
    return ethers.hexlify(trimmed);
  }
  if (trimmed.includes('.')) {
    return ethers.namehash(trimmed.toLowerCase());
  }
  throw new Error(
    `${label} must be a 32-byte hex string or a fully-qualified ENS name`
  );
}

function parseAliasList(envKey: string, enabled: boolean): AliasUpdate[] {
  const raw = process.env[envKey];
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => ({
      root: parseNode(entry, envKey),
      enabled,
    }));
}

function mergeAliasUpdates(
  base: AliasUpdate[],
  additions: AliasUpdate[]
): AliasUpdate[] {
  const merged = [...base];
  for (const update of additions) {
    const index = merged.findIndex(
      (candidate) => candidate.root.toLowerCase() === update.root.toLowerCase()
    );
    if (index >= 0) {
      merged[index] = update;
    } else {
      merged.push(update);
    }
  }
  return merged;
}

async function sendIfNeeded(
  description: string,
  current: string,
  desired: string,
  sender: () => Promise<ContractTransactionResponse>
) {
  if (current.toLowerCase() === desired.toLowerCase()) {
    console.log(`${description} already set to ${desired}`);
    return;
  }
  const tx = await sender();
  console.log(`${description} tx: ${tx.hash}`);
  await tx.wait();
}

async function ensureCanonicalAlias(
  label: string,
  canonicalRoot: string,
  infoFetcher: (root: string) => Promise<{ exists: boolean; enabled: boolean }>,
  updates: AliasUpdate[]
): Promise<AliasUpdate[]> {
  const lowerCanonical = canonicalRoot.toLowerCase();
  if (
    updates.some(
      (update) =>
        update.root.toLowerCase() === lowerCanonical && update.enabled === false
    )
  ) {
    throw new Error(
      `${label} cannot be disabled. Remove it from the ${label} updates.`
    );
  }

  if (
    updates.some(
      (update) =>
        update.root.toLowerCase() === lowerCanonical && update.enabled === true
    )
  ) {
    return updates;
  }

  const info = await infoFetcher(canonicalRoot);
  const exists = (info as any).exists ?? (info as any)[0];
  const enabled = (info as any).enabled ?? (info as any)[1];
  if (!exists || !enabled) {
    console.log(`Ensuring canonical ${label} alias is enabled`);
    return [...updates, { root: canonicalRoot, enabled: true }];
  }
  return updates;
}

async function main() {
  const registryAddr = requireAddress(
    process.env.IDENTITY_REGISTRY,
    'IDENTITY_REGISTRY'
  );
  const ensAddr = requireAddress(process.env.ENS_REGISTRY, 'ENS_REGISTRY');
  const wrapperAddr = requireAddress(process.env.NAME_WRAPPER, 'NAME_WRAPPER');
  const agentRoot = parseNode(process.env.AGENT_ROOT_NODE, 'AGENT_ROOT_NODE');
  const clubRoot = parseNode(process.env.CLUB_ROOT_NODE, 'CLUB_ROOT_NODE');

  const identity = await ethers.getContractAt(
    'contracts/IdentityRegistry.sol:IdentityRegistry',
    registryAddr
  );

  await sendIfNeeded('setENS', await identity.ens(), ensAddr, () =>
    identity.setENS(ensAddr)
  );

  await sendIfNeeded(
    'setNameWrapper',
    await identity.nameWrapper(),
    wrapperAddr,
    () => identity.setNameWrapper(wrapperAddr)
  );

  await sendIfNeeded(
    'setAgentRootNode',
    await identity.agentRootNode(),
    agentRoot,
    () => identity.setAgentRootNode(agentRoot)
  );

  await sendIfNeeded(
    'setClubRootNode',
    await identity.clubRootNode(),
    clubRoot,
    () => identity.setClubRootNode(clubRoot)
  );

  let agentAliasUpdates = mergeAliasUpdates(
    parseAliasList('ENABLE_AGENT_ALIASES', true),
    parseAliasList('DISABLE_AGENT_ALIASES', false)
  );
  let clubAliasUpdates = mergeAliasUpdates(
    parseAliasList('ENABLE_CLUB_ALIASES', true),
    parseAliasList('DISABLE_CLUB_ALIASES', false)
  );

  const canonicalAgentRoot = await identity.MAINNET_ALPHA_AGENT_ROOT_NODE();
  const canonicalClubRoot = await identity.MAINNET_ALPHA_CLUB_ROOT_NODE();

  agentAliasUpdates = await ensureCanonicalAlias(
    'alpha.agent.agi.eth',
    canonicalAgentRoot,
    async (root) => identity.agentRootAliasInfo(root),
    agentAliasUpdates
  );

  clubAliasUpdates = await ensureCanonicalAlias(
    'alpha.club.agi.eth',
    canonicalClubRoot,
    async (root) => identity.clubRootAliasInfo(root),
    clubAliasUpdates
  );

  if (agentAliasUpdates.length || clubAliasUpdates.length) {
    const tx = await identity.applyAliasConfiguration(
      agentAliasUpdates,
      clubAliasUpdates
    );
    console.log(`applyAliasConfiguration tx: ${tx.hash}`);
    await tx.wait();
  } else {
    console.log('No alias updates requested');
  }

  console.log('IdentityRegistry ENS configuration complete');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
