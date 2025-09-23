import { ethers, network } from 'hardhat';
import type { Contract } from 'ethers';
import { loadTokenConfig, loadPlatformIncentivesConfig } from '../config';

interface CliOptions {
  execute: boolean;
  configPath?: string;
  address?: string;
}

interface PlannedAction {
  label: string;
  method: string;
  args: string[];
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { execute: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute') {
      options.execute = true;
    } else if (arg === '--config') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--config requires a file path');
      }
      options.configPath = value;
      i += 1;
    } else if (arg === '--address') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--address requires a contract address');
      }
      options.address = value;
      i += 1;
    }
  }
  return options;
}

function sameAddress(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  try {
    return ethers.getAddress(a) === ethers.getAddress(b);
  } catch {
    return false;
  }
}

function describeAddress(label: string, value: string): string {
  const normalised = ethers.getAddress(value);
  if (normalised === ethers.ZeroAddress) {
    return `${label}: <unset>`;
  }
  return `${label}: ${normalised}`;
}

async function resolveContractAddress(
  cli: CliOptions,
  configAddress?: string,
  moduleAddress?: string
): Promise<string> {
  const candidates = [cli.address, configAddress, moduleAddress];
  for (const candidate of candidates) {
    if (candidate) {
      return ethers.getAddress(candidate);
    }
  }
  throw new Error(
    'PlatformIncentives address not provided. Supply --address, set "address" in the config, or populate agialpha.modules.platformIncentives.'
  );
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));

  const { config: tokenConfig } = loadTokenConfig({
    network: network.name,
    chainId: network.config?.chainId,
  });

  const { config: incentivesConfig, path: configPath } =
    loadPlatformIncentivesConfig({
      network: network.name,
      chainId: network.config?.chainId,
      path: cli.configPath,
    });

  const platformIncentivesAddress = await resolveContractAddress(
    cli,
    incentivesConfig.address,
    tokenConfig.modules?.platformIncentives
  );

  const platformIncentives = (await ethers.getContractAt(
    'contracts/PlatformIncentives.sol:PlatformIncentives',
    platformIncentivesAddress
  )) as Contract;

  const signer = await ethers.getSigner();
  const signerAddress = await signer.getAddress();
  const ownerAddress = await platformIncentives.owner();

  if (cli.execute && !sameAddress(ownerAddress, signerAddress)) {
    throw new Error(
      `Signer ${signerAddress} is not the PlatformIncentives owner ${ownerAddress}`
    );
  }

  if (!sameAddress(ownerAddress, signerAddress)) {
    console.warn(
      `Connected signer ${signerAddress} is not the contract owner ${ownerAddress}. Running in dry-run mode.`
    );
  }

  const [currentStakeManager, currentPlatformRegistry, currentJobRouter] =
    await Promise.all([
      platformIncentives.stakeManager(),
      platformIncentives.platformRegistry(),
      platformIncentives.jobRouter(),
    ]);

  const desiredStakeManager =
    incentivesConfig.stakeManager !== undefined
      ? ethers.getAddress(incentivesConfig.stakeManager)
      : undefined;
  const desiredPlatformRegistry =
    incentivesConfig.platformRegistry !== undefined
      ? ethers.getAddress(incentivesConfig.platformRegistry)
      : undefined;
  const desiredJobRouter =
    incentivesConfig.jobRouter !== undefined
      ? ethers.getAddress(incentivesConfig.jobRouter)
      : undefined;

  const current = {
    stakeManager: ethers.getAddress(currentStakeManager),
    platformRegistry: ethers.getAddress(currentPlatformRegistry),
    jobRouter: ethers.getAddress(currentJobRouter),
  };

  const target = {
    stakeManager: desiredStakeManager ?? current.stakeManager,
    platformRegistry: desiredPlatformRegistry ?? current.platformRegistry,
    jobRouter: desiredJobRouter ?? current.jobRouter,
  };

  const planned: PlannedAction[] = [];
  const changedFields: string[] = [];

  for (const key of Object.keys(target) as (keyof typeof target)[]) {
    if (!sameAddress(current[key], target[key])) {
      changedFields.push(key);
    }
  }

  if (changedFields.length > 0) {
    planned.push({
      label: 'Update module wiring',
      method: 'setModules',
      args: [target.stakeManager, target.platformRegistry, target.jobRouter],
    });
  }

  console.log('PlatformIncentives maintenance plan');
  console.log('-----------------------------------');
  console.log(`Config file: ${configPath}`);
  console.log(describeAddress('Contract', platformIncentivesAddress));
  console.log(describeAddress('Current stakeManager', current.stakeManager));
  console.log(
    describeAddress('Current platformRegistry', current.platformRegistry)
  );
  console.log(describeAddress('Current jobRouter', current.jobRouter));

  if (changedFields.length === 0) {
    console.log(
      '\nNo module updates required. All addresses already match the configuration.'
    );
    return;
  }

  console.log('\nPlanned updates:');
  for (const field of changedFields) {
    console.log(
      `- ${field}: ${describeAddress(
        'current',
        current[field]
      )} -> ${describeAddress('target', target[field])}`
    );
  }

  if (!cli.execute) {
    console.log('\nDry run complete. Re-run with --execute to apply changes.');
    return;
  }

  console.log('\nExecuting updates...');
  for (const action of planned) {
    console.log(`Calling ${action.method}(${action.args.join(', ')})`);
    const tx = await platformIncentives
      .connect(signer)
      [action.method](...action.args);
    console.log(
      `Submitted transaction ${tx.hash}, waiting for confirmations...`
    );
    const receipt = await tx.wait();
    console.log(
      `Confirmed in block ${
        receipt.blockNumber
      }. Gas used: ${receipt.gasUsed?.toString()}`
    );
  }

  console.log('All updates applied successfully.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
