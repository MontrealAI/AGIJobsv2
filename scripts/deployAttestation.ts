import { ethers } from 'hardhat';

const MAINNET_ENS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const MAINNET_NAME_WRAPPER = '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401';

function usage() {
  console.log('Usage:');
  console.log(
    '  IDENTITY_REGISTRY=<addr> npx hardhat run scripts/deployAttestation.ts --network <network> [ensRegistry nameWrapper]'
  );
  console.log(
    '  ensRegistry and nameWrapper default to mainnet addresses if omitted'
  );
}

async function main() {
  const [ensArg, wrapperArg] = process.argv.slice(2);
  const identityAddr = process.env.IDENTITY_REGISTRY;
  if (!identityAddr) {
    usage();
    throw new Error('IDENTITY_REGISTRY env var required');
  }

  const ensAddr = ethers.getAddress(
    ensArg || process.env.ENS_REGISTRY || MAINNET_ENS
  );
  const wrapperAddr = ethers.getAddress(
    wrapperArg || process.env.NAME_WRAPPER || MAINNET_NAME_WRAPPER
  );

  const Attestation = await ethers.getContractFactory(
    'contracts/AttestationRegistry.sol:AttestationRegistry'
  );

  // Deploy with zero addresses first, then configure ENS and NameWrapper
  const att = await Attestation.deploy(ethers.ZeroAddress, ethers.ZeroAddress);
  await att.waitForDeployment();

  await (await att.setENS(ensAddr)).wait();
  await (await att.setNameWrapper(wrapperAddr)).wait();

  const identity = await ethers.getContractAt(
    'contracts/IdentityRegistry.sol:IdentityRegistry',
    identityAddr
  );
  await identity.setAttestationRegistry(await att.getAddress());

  console.log('AttestationRegistry:', await att.getAddress());
  console.log('  ENS:', ensAddr);
  console.log('  NameWrapper:', wrapperAddr);
  console.log('IdentityRegistry:', identityAddr);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
