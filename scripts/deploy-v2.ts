import { ethers } from 'hardhat';

// Mainnet ENS registry and NameWrapper addresses
// ENS registry: 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
// NameWrapper: 0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const NAME_WRAPPER = '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401';

async function main() {
  const [deployer] = await ethers.getSigners();

  const Stake = await ethers.getContractFactory(
    'contracts/StakeManager.sol:StakeManager'
  );
  const stake = await Stake.deploy(
    0,
    0,
    0,
    deployer.address,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    deployer.address
  );
  await stake.waitForDeployment();

  // Deploy the sole ReputationEngine implementation
  const Reputation = await ethers.getContractFactory(
    'contracts/ReputationEngine.sol:ReputationEngine'
  );
  const reputation = await Reputation.deploy(await stake.getAddress());
  await reputation.waitForDeployment();

  const Validation = await ethers.getContractFactory(
    'contracts/mocks/ValidationStub.sol:ValidationStub'
  );
  const validation = await Validation.deploy();
  await validation.waitForDeployment();

  const NFT = await ethers.getContractFactory(
    'contracts/CertificateNFT.sol:CertificateNFT'
  );
  const nft = await NFT.deploy('Cert', 'CERT');
  await nft.waitForDeployment();

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
    deployer.address
  );
  await registry.waitForDeployment();

  const Identity = await ethers.getContractFactory(
    'contracts/IdentityRegistry.sol:IdentityRegistry'
  );
  const identity = await Identity.deploy(
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    await reputation.getAddress(),
    ethers.ZeroHash,
    ethers.ZeroHash
  );
  await identity.waitForDeployment();
  await identity.configureMainnet();

  const Attestation = await ethers.getContractFactory(
    'contracts/AttestationRegistry.sol:AttestationRegistry'
  );
  const attestation = await Attestation.deploy(ENS_REGISTRY, NAME_WRAPPER);
  await attestation.waitForDeployment();
  await identity.setAttestationRegistry(await attestation.getAddress());

  const EnergyOracle = await ethers.getContractFactory(
    'contracts/EnergyOracle.sol:EnergyOracle'
  );
  const energyOracle = await EnergyOracle.deploy(deployer.address);
  await energyOracle.waitForDeployment();

  const Dispute = await ethers.getContractFactory(
    'contracts/modules/DisputeModule.sol:DisputeModule'
  );
  const dispute = await Dispute.deploy(
    await registry.getAddress(),
    0,
    0,
    ethers.ZeroAddress
  );
  await dispute.waitForDeployment();
  const Committee = await ethers.getContractFactory(
    'contracts/ArbitratorCommittee.sol:ArbitratorCommittee'
  );
  const committee = await Committee.deploy(
    await registry.getAddress(),
    await dispute.getAddress()
  );
  await committee.waitForDeployment();
  await dispute.setCommittee(await committee.getAddress());
  await dispute.setStakeManager(await stake.getAddress());

  const TaxPolicy = await ethers.getContractFactory(
    'contracts/TaxPolicy.sol:TaxPolicy'
  );
  const tax = await TaxPolicy.deploy(
    'ipfs://policy',
    'All taxes on participants; contract and owner exempt'
  );
  await tax.waitForDeployment();

  const FeePool = await ethers.getContractFactory(
    'contracts/FeePool.sol:FeePool'
  );
  const feePool = await FeePool.deploy(
    await stake.getAddress(),
    0,
    deployer.address,
    await tax.getAddress()
  );
  await feePool.waitForDeployment();

  const initialTemp = ethers.parseUnits('1', 18);
  const minTemp = ethers.parseUnits('0.5', 18);
  const maxTemp = ethers.parseUnits('2', 18);

  const Thermostat = await ethers.getContractFactory(
    'contracts/Thermostat.sol:Thermostat'
  );
  const thermostat = await Thermostat.deploy(
    initialTemp,
    minTemp,
    maxTemp,
    deployer.address
  );
  await thermostat.waitForDeployment();
  await thermostat.setTemperatureBounds(minTemp, maxTemp);

  const RewardEngine = await ethers.getContractFactory(
    'contracts/RewardEngineMB.sol:RewardEngineMB'
  );
  const rewardEngine = await RewardEngine.deploy(
    await thermostat.getAddress(),
    await feePool.getAddress(),
    await reputation.getAddress(),
    await energyOracle.getAddress(),
    deployer.address
  );
  await rewardEngine.waitForDeployment();

  await feePool.setRewarder(await rewardEngine.getAddress(), true);
  await reputation.setCaller(await rewardEngine.getAddress(), true);

  const shares = [
    ethers.parseUnits('0.65', 18),
    ethers.parseUnits('0.15', 18),
    ethers.parseUnits('0.15', 18),
    ethers.parseUnits('0.05', 18),
  ];
  for (let i = 0; i < shares.length; i++) {
    await rewardEngine.setRoleShare(i, shares[i]);
    await rewardEngine.setMu(i, 0);
  }
  await rewardEngine.setSettler(deployer.address, true);
  await energyOracle.setSigner(deployer.address, true);

  const PlatformRegistry = await ethers.getContractFactory(
    'contracts/PlatformRegistry.sol:PlatformRegistry'
  );
  const platformRegistry = await PlatformRegistry.deploy(
    await stake.getAddress(),
    await reputation.getAddress(),
    0
  );
  await platformRegistry.waitForDeployment();

  await stake.setModules(
    await registry.getAddress(),
    await dispute.getAddress()
  );
  await validation.setJobRegistry(await registry.getAddress());
  await nft.setJobRegistry(await registry.getAddress());
  await nft.setStakeManager(await stake.getAddress());
  await registry.setModules(
    await validation.getAddress(),
    await stake.getAddress(),
    await reputation.getAddress(),
    await dispute.getAddress(),
    await nft.getAddress(),
    await feePool.getAddress(),
    []
  );
  await registry.setIdentityRegistry(await identity.getAddress());
  await validation.setIdentityRegistry(await identity.getAddress());
  await reputation.setCaller(await registry.getAddress(), true);

  const ensureContract = async (addr: string, name: string) => {
    if ((await ethers.provider.getCode(addr)) === '0x') {
      throw new Error(`${name} must be a deployed contract`);
    }
  };

  await Promise.all([
    ensureContract(await registry.getAddress(), 'JobRegistry'),
    ensureContract(await stake.getAddress(), 'StakeManager'),
    ensureContract(await validation.getAddress(), 'ValidationModule'),
    ensureContract(await dispute.getAddress(), 'DisputeModule'),
    ensureContract(await platformRegistry.getAddress(), 'PlatformRegistry'),
    ensureContract(await feePool.getAddress(), 'FeePool'),
    ensureContract(await reputation.getAddress(), 'ReputationEngine'),
    ensureContract(await attestation.getAddress(), 'AttestationRegistry'),
    ensureContract(await energyOracle.getAddress(), 'EnergyOracle'),
    ensureContract(await thermostat.getAddress(), 'Thermostat'),
    ensureContract(await rewardEngine.getAddress(), 'RewardEngineMB'),
  ]);

  const SystemPause = await ethers.getContractFactory(
    'contracts/SystemPause.sol:SystemPause'
  );
  const pause = await SystemPause.deploy(
    await registry.getAddress(),
    await stake.getAddress(),
    await validation.getAddress(),
    await dispute.getAddress(),
    await platformRegistry.getAddress(),
    await feePool.getAddress(),
    await reputation.getAddress(),
    await committee.getAddress(),
    deployer.address
  );
  await pause.waitForDeployment();
  await pause.setModules(
    await registry.getAddress(),
    await stake.getAddress(),
    await validation.getAddress(),
    await dispute.getAddress(),
    await platformRegistry.getAddress(),
    await feePool.getAddress(),
    await reputation.getAddress(),
    await committee.getAddress()
  );
  await stake.setGovernance(await pause.getAddress());
  await registry.setGovernance(await pause.getAddress());
  await validation.transferOwnership(await pause.getAddress());
  await dispute.transferOwnership(await pause.getAddress());
  await platformRegistry.transferOwnership(await pause.getAddress());
  await feePool.transferOwnership(await pause.getAddress());
  await reputation.transferOwnership(await pause.getAddress());
  await committee.transferOwnership(await pause.getAddress());
  await nft.transferOwnership(await pause.getAddress());
  await identity.transferOwnership(await pause.getAddress());
  await attestation.transferOwnership(await pause.getAddress());
  await energyOracle.setGovernance(await pause.getAddress());
  await rewardEngine.setGovernance(await pause.getAddress());
  await thermostat.setGovernance(await pause.getAddress());

  console.log('StakeManager:', await stake.getAddress());
  console.log('ReputationEngine:', await reputation.getAddress());
  console.log('IdentityRegistry:', await identity.getAddress());
  console.log('AttestationRegistry:', await attestation.getAddress());
  console.log('JobRegistry:', await registry.getAddress());
  console.log('DisputeModule:', await dispute.getAddress());
  console.log('CertificateNFT:', await nft.getAddress());
  console.log('EnergyOracle:', await energyOracle.getAddress());
  console.log('Thermostat:', await thermostat.getAddress());
  console.log('RewardEngineMB:', await rewardEngine.getAddress());
  console.log('SystemPause:', await pause.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
