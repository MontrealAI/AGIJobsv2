/**
 * Commit and reveal validation votes while persisting the salt locally.
 *
 * Usage:
 *   node examples/commit-reveal.js commit <jobId> <approve> [salt] [subdomain] [burnTxHash] [proofJson]
 *   node examples/commit-reveal.js reveal <jobId> [approve] [salt] [subdomain] [burnTxHash] [proofJson]
 *
 * Environment:
 *   RPC_URL, PRIVATE_KEY, VALIDATION_MODULE
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

if (!process.env.VALIDATION_MODULE) {
  throw new Error('VALIDATION_MODULE env var is required');
}
if (!process.env.PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY env var is required');
}

const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL || 'http://localhost:8545'
);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const validationAbi = [
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function jobRegistry() view returns (address)',
  'function jobNonce(uint256) view returns (uint256)',
  'function commitValidation(uint256,bytes32,string,bytes32[])',
  'function revealValidation(uint256,bool,bytes32,bytes32,string,bytes32[])',
];

const registryAbi = [
  'function acknowledgeTaxPolicy() returns (string)',
  'function getSpecHash(uint256) view returns (bytes32)',
];

const validation = new ethers.Contract(
  process.env.VALIDATION_MODULE,
  validationAbi,
  wallet
);

let cachedRegistry;
async function getRegistry() {
  if (!cachedRegistry) {
    const registryAddr = await validation.jobRegistry();
    cachedRegistry = new ethers.Contract(registryAddr, registryAbi, wallet);
  }
  return cachedRegistry;
}

const STORAGE_ROOT = path.resolve(__dirname, '../storage/validation');

function ensureStorage() {
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true, mode: 0o700 });
  }
}

function storagePath(jobId, address) {
  const suffix = address.toLowerCase();
  return path.join(STORAGE_ROOT, `${jobId}-${suffix}.json`);
}

function loadRecord(jobId, address) {
  try {
    const raw = fs.readFileSync(storagePath(jobId, address), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('Failed to read commit record', err.message || err);
    }
    return {};
  }
}

function saveRecord(jobId, address, update) {
  ensureStorage();
  const file = storagePath(jobId, address);
  const existing = loadRecord(jobId, address);
  const record = { ...existing, ...update };
  fs.writeFileSync(file, JSON.stringify(record, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch (err) {
    console.warn('chmod failed for commit record', err);
  }
  return record;
}

function isHexSalt(value) {
  return typeof value === 'string' && /^0x?[0-9a-fA-F]{64}$/.test(value.trim());
}

function normaliseBytes32(value, label) {
  if (!value) return ethers.ZeroHash;
  const candidate = value.startsWith('0x') ? value : `0x${value}`;
  const bytes = ethers.getBytes(candidate);
  if (bytes.length !== 32) {
    throw new Error(`${label} must be 32 bytes`);
  }
  return ethers.hexlify(bytes);
}

function normaliseSalt(value) {
  return value
    ? normaliseBytes32(value, 'salt')
    : ethers.hexlify(ethers.randomBytes(32));
}

function parseProofArg(arg) {
  if (!arg) return [];
  try {
    const parsed = JSON.parse(arg);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => normaliseBytes32(entry, 'proof entry'))
        .filter(Boolean);
    }
  } catch (err) {
    // fallthrough to plain parsing
  }
  const cleaned = String(arg).trim();
  if (!cleaned || cleaned === '[]' || cleaned === '0x') {
    return [];
  }
  return cleaned
    .replace(/^[\[\{\s]+|[\]\}\s]+$/g, '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => normaliseBytes32(entry, 'proof entry'));
}

async function ensureAcknowledged(registry) {
  try {
    await registry.acknowledgeTaxPolicy();
  } catch (err) {
    console.warn('acknowledgeTaxPolicy failed:', err.message || err);
  }
}

async function buildCommitHash(jobId, approve, burnTxHash, salt) {
  const [nonce, domain, network, registry] = await Promise.all([
    validation.jobNonce(jobId),
    validation.DOMAIN_SEPARATOR(),
    provider.getNetwork(),
    getRegistry(),
  ]);
  const specHash = await registry.getSpecHash(jobId);
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const outcomeHash = ethers.keccak256(
    abi.encode(
      ['uint256', 'bytes32', 'bool', 'bytes32'],
      [nonce, specHash, approve, burnTxHash]
    )
  );
  return ethers.keccak256(
    abi.encode(
      ['uint256', 'bytes32', 'bytes32', 'address', 'uint256', 'bytes32'],
      [jobId, outcomeHash, salt, wallet.address, network.chainId, domain]
    )
  );
}

async function commit(jobId, approve, burnTxHash, saltArg, subdomain, proof) {
  const registry = await getRegistry();
  await ensureAcknowledged(registry);
  const salt = normaliseSalt(saltArg);
  const commitHash = await buildCommitHash(jobId, approve, burnTxHash, salt);
  const tx = await validation.commitValidation(
    jobId,
    commitHash,
    subdomain,
    proof
  );
  await tx.wait();
  const record = saveRecord(jobId, wallet.address, {
    jobId: jobId.toString(),
    validator: wallet.address,
    approve,
    burnTxHash,
    salt,
    subdomain,
    proof,
    commitHash,
    commitTx: tx.hash,
    committedAt: new Date().toISOString(),
  });
  console.log('Committed validation', tx.hash);
  console.log('Stored state at', storagePath(jobId, wallet.address));
  console.log('Record:', record);
}

async function reveal(
  jobId,
  approveArg,
  saltArg,
  subdomainArg,
  burnArg,
  proofArg
) {
  const record = loadRecord(jobId, wallet.address);
  const approve = typeof approveArg === 'boolean' ? approveArg : record.approve;
  if (typeof approve !== 'boolean') {
    throw new Error('Approve flag missing. Provide it or commit first.');
  }
  const saltSource = saltArg || record.salt;
  if (!saltSource) {
    throw new Error('Salt missing. Provide it or ensure commit record exists.');
  }
  const burnTxHash = normaliseBytes32(
    burnArg || record.burnTxHash,
    'burnTxHash'
  );
  const salt = normaliseSalt(saltSource);
  const subdomain =
    typeof subdomainArg === 'string' && subdomainArg.length > 0
      ? subdomainArg
      : record.subdomain || '';
  const proof = proofArg ? parseProofArg(proofArg) : record.proof || [];
  const registry = await getRegistry();
  await ensureAcknowledged(registry);
  const tx = await validation.revealValidation(
    jobId,
    approve,
    burnTxHash,
    salt,
    subdomain,
    proof
  );
  await tx.wait();
  const updated = saveRecord(jobId, wallet.address, {
    approve,
    burnTxHash,
    salt,
    subdomain,
    proof,
    revealTx: tx.hash,
    revealedAt: new Date().toISOString(),
  });
  console.log('Revealed validation', tx.hash);
  console.log('Updated record:', updated);
}

async function main() {
  const [action, jobIdArg, approveArg, ...rest] = process.argv.slice(2);
  if (!action || !jobIdArg) {
    console.error(
      'Usage: node examples/commit-reveal.js commit|reveal jobId approve [salt] [subdomain] [burnTxHash] [proofJson]'
    );
    process.exit(1);
  }
  const jobId = ethers.getBigInt(jobIdArg);
  const approveValue =
    typeof approveArg === 'undefined' ? undefined : approveArg === 'true';
  const saltCandidate = rest[0];
  const hasSalt = isHexSalt(saltCandidate);
  const subdomain = hasSalt ? rest[1] || '' : saltCandidate || '';
  const burnArg = hasSalt ? rest[2] : rest[1];
  const proofArg = hasSalt ? rest[3] : rest[2];
  const saltInput = hasSalt ? saltCandidate : undefined;
  const burnTxHash = normaliseBytes32(burnArg, 'burnTxHash');
  const proof = parseProofArg(proofArg);

  if (action === 'commit') {
    if (approveValue === undefined) {
      throw new Error('Approve flag required for commit');
    }
    await commit(jobId, approveValue, burnTxHash, saltInput, subdomain, proof);
  } else if (action === 'reveal') {
    await reveal(jobId, approveValue, saltInput, subdomain, burnArg, proofArg);
  } else {
    console.error('Unknown action', action);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
