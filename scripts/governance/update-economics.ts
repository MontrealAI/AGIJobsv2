import fs from 'fs';
import path from 'path';
import { ethers, artifacts, network } from 'hardhat';
import type { Contract, Signer } from 'ethers';

type PercentInput = number | string;
type TokenAmountInput = number | string;
type IntegerInput = number | string;

interface TreasuryAllowlistUpdate {
  address: string;
  allowed: boolean;
}

interface JobRegistryConfig {
  address: string;
  feePct?: PercentInput;
  validatorRewardPct?: PercentInput;
  treasury?: string;
  jobStakeTokens?: TokenAmountInput;
  minAgentStakeTokens?: TokenAmountInput;
  maxJobRewardTokens?: TokenAmountInput;
  maxJobDurationSeconds?: IntegerInput;
  maxActiveJobsPerAgent?: IntegerInput;
  expirationGracePeriodSeconds?: IntegerInput;
  taxPolicy?: string;
  feePool?: string;
}

interface StakeManagerConfig {
  address: string;
  minStakeTokens?: TokenAmountInput;
  employerSlashPct?: PercentInput;
  treasurySlashPct?: PercentInput;
  treasury?: string;
  treasuryAllowlist?: TreasuryAllowlistUpdate[];
  feePct?: PercentInput;
  burnPct?: PercentInput;
  validatorRewardPct?: PercentInput;
  unbondingPeriodSeconds?: IntegerInput;
  maxStakePerAddressTokens?: TokenAmountInput;
  stakeRecommendations?: {
    minTokens: TokenAmountInput;
    maxTokens?: TokenAmountInput;
  };
}

interface FeePoolConfig {
  address: string;
  burnPct?: PercentInput;
  treasury?: string;
  treasuryAllowlist?: TreasuryAllowlistUpdate[];
}

interface TaxPolicyConfig {
  address: string;
  policyURI?: string;
  acknowledgement?: string;
  policy?: {
    uri: string;
    acknowledgement: string;
  };
  acknowledgers?: TreasuryAllowlistUpdate[];
}

interface GovernanceUpdateConfig {
  jobRegistry?: JobRegistryConfig;
  stakeManager?: StakeManagerConfig;
  feePool?: FeePoolConfig;
  taxPolicy?: TaxPolicyConfig;
}

interface CliOptions {
  configPath?: string;
  execute: boolean;
  quiet: boolean;
}

interface PlannedAction {
  contract: Contract;
  method: string;
  args: unknown[];
  description: string;
  current?: string;
  desired?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { execute: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config') {
      const value = argv[i + 1];
      if (!value) throw new Error('--config requires a file path');
      options.configPath = value;
      i += 1;
    } else if (arg === '--execute') {
      options.execute = true;
    } else if (arg === '--quiet') {
      options.quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        `Usage: npx hardhat run --network <network> ${path
          .relative(process.cwd(), __filename)
          .replace('\\', '/')} [options]\n\n` +
          'Options:\n' +
          '  --config <path>   Path to governance update JSON file\n' +
          '  --execute         Apply the planned changes\n' +
          '  --quiet           Only print warnings and summary\n' +
          '  -h, --help        Show this help message\n'
      );
      process.exit(0);
    }
  }
  return options;
}

function loadConfig(configPath?: string): GovernanceUpdateConfig {
  const resolved = configPath
    ? path.resolve(process.cwd(), configPath)
    : path.resolve(__dirname, '..', '..', 'config', 'governance-update.json');
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Governance update config not found at ${resolved}. Create one from config/governance-update.example.json`
    );
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Governance update config must be a JSON object');
  }
  return parsed as GovernanceUpdateConfig;
}

function ensureAddress(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  try {
    return ethers.getAddress(value);
  } catch (error) {
    throw new Error(
      `${label} must be a valid address: ${(error as Error).message}`
    );
  }
}

function normaliseOptionalAddress(
  value: string | undefined
): string | undefined {
  if (!value) return undefined;
  return ethers.getAddress(value);
}

function formatAddress(value: string): string {
  return ethers.getAddress(value);
}

function parsePercent(
  value: PercentInput | undefined,
  label: string
): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  const asString = typeof value === 'string' ? value.trim() : value.toString();
  if (!asString) return undefined;
  const parsed = Number(asString);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (parsed < 0 || parsed > 100) {
    throw new Error(`${label} must be between 0 and 100`);
  }
  return BigInt(Math.round(parsed));
}

function parseInteger(
  value: IntegerInput | undefined,
  label: string
): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  const asString = typeof value === 'string' ? value.trim() : value.toString();
  if (!/^\d+$/.test(asString)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return BigInt(asString);
}

function parseTokenAmount(
  value: TokenAmountInput | undefined,
  label: string
): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  const asString = typeof value === 'string' ? value.trim() : value.toString();
  if (!asString) return undefined;
  try {
    return ethers.parseUnits(asString, 18);
  } catch (error) {
    throw new Error(
      `${label} must be a valid decimal token amount: ${
        (error as Error).message
      }`
    );
  }
}

function formatPercent(value: bigint | number): string {
  const asBigInt = typeof value === 'number' ? BigInt(value) : value;
  return `${asBigInt.toString()}%`;
}

function formatTokenAmount(value: bigint): string {
  return `${ethers.formatUnits(value, 18)} AGIALPHA`;
}

function formatSeconds(value: bigint): string {
  return `${value.toString()} seconds`;
}

function sameAddress(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return ethers.getAddress(a) === ethers.getAddress(b);
}

async function connectContract(
  name: string,
  address: string,
  signer: Signer
): Promise<Contract> {
  const artifact = await artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signer);
}

async function planJobRegistryActions(
  signer: Signer,
  config: JobRegistryConfig,
  options: CliOptions
): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];
  const jobRegistry = await connectContract(
    'JobRegistry',
    ensureAddress(config.address, 'jobRegistry.address'),
    signer
  );

  const feePct = parsePercent(config.feePct, 'jobRegistry.feePct');
  if (feePct !== undefined) {
    const current = await jobRegistry.feePct();
    if (current !== feePct) {
      actions.push({
        contract: jobRegistry,
        method: 'setFeePct',
        args: [feePct],
        description: 'Update JobRegistry protocol fee percentage',
        current: formatPercent(current),
        desired: formatPercent(feePct),
      });
    } else if (!options.quiet) {
      console.log(`JobRegistry feePct already ${formatPercent(current)}`);
    }
  }

  const validatorRewardPct = parsePercent(
    config.validatorRewardPct,
    'jobRegistry.validatorRewardPct'
  );
  if (validatorRewardPct !== undefined) {
    const current = await jobRegistry.validatorRewardPct();
    if (current !== validatorRewardPct) {
      actions.push({
        contract: jobRegistry,
        method: 'setValidatorRewardPct',
        args: [validatorRewardPct],
        description: 'Update validator reward percentage',
        current: formatPercent(current),
        desired: formatPercent(validatorRewardPct),
      });
    } else if (!options.quiet) {
      console.log(
        `JobRegistry validatorRewardPct already ${formatPercent(current)}`
      );
    }
  }

  const treasury = normaliseOptionalAddress(config.treasury);
  if (treasury !== undefined) {
    const current = await jobRegistry.treasury();
    if (!sameAddress(current, treasury)) {
      actions.push({
        contract: jobRegistry,
        method: 'setTreasury',
        args: [treasury],
        description: 'Set JobRegistry treasury address',
        current: formatAddress(current),
        desired: formatAddress(treasury),
      });
    } else if (!options.quiet) {
      console.log(`JobRegistry treasury already ${formatAddress(current)}`);
    }
  }

  const jobStake = parseTokenAmount(
    config.jobStakeTokens,
    'jobRegistry.jobStakeTokens'
  );
  if (jobStake !== undefined) {
    const current = await jobRegistry.jobStake();
    if (current !== jobStake) {
      actions.push({
        contract: jobRegistry,
        method: 'setJobStake',
        args: [jobStake],
        description: 'Update per-job stake requirement',
        current: formatTokenAmount(current),
        desired: formatTokenAmount(jobStake),
      });
    } else if (!options.quiet) {
      console.log(`JobRegistry jobStake already ${formatTokenAmount(current)}`);
    }
  }

  const minAgentStake = parseTokenAmount(
    config.minAgentStakeTokens,
    'jobRegistry.minAgentStakeTokens'
  );
  if (minAgentStake !== undefined) {
    const current = await jobRegistry.minAgentStake();
    if (current !== minAgentStake) {
      actions.push({
        contract: jobRegistry,
        method: 'setMinAgentStake',
        args: [minAgentStake],
        description: 'Update minimum agent stake',
        current: formatTokenAmount(current),
        desired: formatTokenAmount(minAgentStake),
      });
    } else if (!options.quiet) {
      console.log(
        `JobRegistry minAgentStake already ${formatTokenAmount(current)}`
      );
    }
  }

  const maxJobReward = parseTokenAmount(
    config.maxJobRewardTokens,
    'jobRegistry.maxJobRewardTokens'
  );
  if (maxJobReward !== undefined) {
    const current = await jobRegistry.maxJobReward();
    if (current !== maxJobReward) {
      actions.push({
        contract: jobRegistry,
        method: 'setMaxJobReward',
        args: [maxJobReward],
        description: 'Update maximum job reward',
        current: formatTokenAmount(current),
        desired: formatTokenAmount(maxJobReward),
      });
    } else if (!options.quiet) {
      console.log(
        `JobRegistry maxJobReward already ${formatTokenAmount(current)}`
      );
    }
  }

  const maxJobDuration = parseInteger(
    config.maxJobDurationSeconds,
    'jobRegistry.maxJobDurationSeconds'
  );
  if (maxJobDuration !== undefined) {
    const current = await jobRegistry.maxJobDuration();
    if (current !== maxJobDuration) {
      actions.push({
        contract: jobRegistry,
        method: 'setJobDurationLimit',
        args: [maxJobDuration],
        description: 'Update maximum job duration',
        current: formatSeconds(current),
        desired: formatSeconds(maxJobDuration),
      });
    } else if (!options.quiet) {
      console.log(
        `JobRegistry maxJobDuration already ${formatSeconds(current)}`
      );
    }
  }

  const maxActiveJobs = parseInteger(
    config.maxActiveJobsPerAgent,
    'jobRegistry.maxActiveJobsPerAgent'
  );
  if (maxActiveJobs !== undefined) {
    const current = await jobRegistry.maxActiveJobsPerAgent();
    if (current !== maxActiveJobs) {
      actions.push({
        contract: jobRegistry,
        method: 'setMaxActiveJobsPerAgent',
        args: [maxActiveJobs],
        description: 'Update maximum concurrent jobs per agent',
        current: current.toString(),
        desired: maxActiveJobs.toString(),
      });
    } else if (!options.quiet) {
      console.log(
        `JobRegistry maxActiveJobsPerAgent already ${current.toString()}`
      );
    }
  }

  const expirationGrace = parseInteger(
    config.expirationGracePeriodSeconds,
    'jobRegistry.expirationGracePeriodSeconds'
  );
  if (expirationGrace !== undefined) {
    const current = await jobRegistry.expirationGracePeriod();
    if (current !== expirationGrace) {
      actions.push({
        contract: jobRegistry,
        method: 'setExpirationGracePeriod',
        args: [expirationGrace],
        description: 'Update expiration grace period',
        current: formatSeconds(current),
        desired: formatSeconds(expirationGrace),
      });
    } else if (!options.quiet) {
      console.log(
        `JobRegistry expirationGracePeriod already ${formatSeconds(current)}`
      );
    }
  }

  const feePool = normaliseOptionalAddress(config.feePool);
  if (feePool !== undefined) {
    const current = await jobRegistry.feePool();
    if (!sameAddress(current, feePool)) {
      actions.push({
        contract: jobRegistry,
        method: 'setFeePool',
        args: [feePool],
        description: 'Wire JobRegistry to FeePool',
        current: formatAddress(current),
        desired: formatAddress(feePool),
      });
    } else if (!options.quiet) {
      console.log(`JobRegistry feePool already ${formatAddress(current)}`);
    }
  }

  const taxPolicy = normaliseOptionalAddress(config.taxPolicy);
  if (taxPolicy !== undefined) {
    const current = await jobRegistry.taxPolicy();
    if (!sameAddress(current, taxPolicy)) {
      actions.push({
        contract: jobRegistry,
        method: 'setTaxPolicy',
        args: [taxPolicy],
        description: 'Set JobRegistry tax policy reference',
        current: formatAddress(current),
        desired: formatAddress(taxPolicy),
      });
    } else if (!options.quiet) {
      console.log(`JobRegistry taxPolicy already ${formatAddress(current)}`);
    }
  }

  return actions;
}

async function planStakeManagerActions(
  signer: Signer,
  config: StakeManagerConfig,
  options: CliOptions
): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];
  const stakeManager = await connectContract(
    'StakeManager',
    ensureAddress(config.address, 'stakeManager.address'),
    signer
  );

  const minStake = parseTokenAmount(
    config.minStakeTokens,
    'stakeManager.minStakeTokens'
  );
  if (minStake !== undefined) {
    const current = await stakeManager.minStake();
    if (current !== minStake) {
      actions.push({
        contract: stakeManager,
        method: 'setMinStake',
        args: [minStake],
        description: 'Update StakeManager minimum stake',
        current: formatTokenAmount(current),
        desired: formatTokenAmount(minStake),
      });
    } else if (!options.quiet) {
      console.log(
        `StakeManager minStake already ${formatTokenAmount(current)}`
      );
    }
  }

  const employerSlashPct = parsePercent(
    config.employerSlashPct,
    'stakeManager.employerSlashPct'
  );
  const treasurySlashPct = parsePercent(
    config.treasurySlashPct,
    'stakeManager.treasurySlashPct'
  );
  if (employerSlashPct !== undefined || treasurySlashPct !== undefined) {
    const currentEmployer = await stakeManager.employerSlashPct();
    const currentTreasury = await stakeManager.treasurySlashPct();
    const desiredEmployer = employerSlashPct ?? currentEmployer;
    const desiredTreasury = treasurySlashPct ?? currentTreasury;
    if (
      currentEmployer !== desiredEmployer ||
      currentTreasury !== desiredTreasury
    ) {
      actions.push({
        contract: stakeManager,
        method: 'setSlashingPercentages',
        args: [desiredEmployer, desiredTreasury],
        description: 'Update StakeManager slashing percentages',
        current: `${formatPercent(currentEmployer)} employer / ${formatPercent(
          currentTreasury
        )} treasury`,
        desired: `${formatPercent(desiredEmployer)} employer / ${formatPercent(
          desiredTreasury
        )} treasury`,
      });
    } else if (!options.quiet) {
      console.log(
        `StakeManager slashing percentages already ${formatPercent(
          currentEmployer
        )} employer / ${formatPercent(currentTreasury)} treasury`
      );
    }
  }

  const stakeTreasury = normaliseOptionalAddress(config.treasury);
  if (stakeTreasury !== undefined) {
    const current = await stakeManager.treasury();
    if (!sameAddress(current, stakeTreasury)) {
      actions.push({
        contract: stakeManager,
        method: 'setTreasury',
        args: [stakeTreasury],
        description: 'Set StakeManager treasury',
        current: formatAddress(current),
        desired: formatAddress(stakeTreasury),
      });
    } else if (!options.quiet) {
      console.log(`StakeManager treasury already ${formatAddress(current)}`);
    }
  }

  if (Array.isArray(config.treasuryAllowlist)) {
    for (const update of config.treasuryAllowlist) {
      const treasuryAddress = ensureAddress(
        update.address,
        'stakeManager.treasuryAllowlist.address'
      );
      const desired = Boolean(update.allowed);
      const current = await stakeManager.treasuryAllowlist(treasuryAddress);
      if (current !== desired) {
        actions.push({
          contract: stakeManager,
          method: 'setTreasuryAllowlist',
          args: [treasuryAddress, desired],
          description: `Update StakeManager treasury allowlist for ${treasuryAddress}`,
          current: current ? 'allowed' : 'blocked',
          desired: desired ? 'allowed' : 'blocked',
        });
      } else if (!options.quiet) {
        console.log(
          `StakeManager treasury allowlist already ${
            desired ? 'allows' : 'blocks'
          } ${treasuryAddress}`
        );
      }
    }
  }

  const feePct = parsePercent(config.feePct, 'stakeManager.feePct');
  if (feePct !== undefined) {
    const current = await stakeManager.feePct();
    if (current !== feePct) {
      actions.push({
        contract: stakeManager,
        method: 'setFeePct',
        args: [feePct],
        description: 'Update StakeManager fee percentage',
        current: formatPercent(current),
        desired: formatPercent(feePct),
      });
    } else if (!options.quiet) {
      console.log(`StakeManager feePct already ${formatPercent(current)}`);
    }
  }

  const burnPct = parsePercent(config.burnPct, 'stakeManager.burnPct');
  if (burnPct !== undefined) {
    const current = await stakeManager.burnPct();
    if (current !== burnPct) {
      actions.push({
        contract: stakeManager,
        method: 'setBurnPct',
        args: [burnPct],
        description: 'Update StakeManager burn percentage',
        current: formatPercent(current),
        desired: formatPercent(burnPct),
      });
    } else if (!options.quiet) {
      console.log(`StakeManager burnPct already ${formatPercent(current)}`);
    }
  }

  const validatorRewardPct = parsePercent(
    config.validatorRewardPct,
    'stakeManager.validatorRewardPct'
  );
  if (validatorRewardPct !== undefined) {
    const current = await stakeManager.validatorRewardPct();
    if (current !== validatorRewardPct) {
      actions.push({
        contract: stakeManager,
        method: 'setValidatorRewardPct',
        args: [validatorRewardPct],
        description: 'Update StakeManager validator reward percentage',
        current: formatPercent(current),
        desired: formatPercent(validatorRewardPct),
      });
    } else if (!options.quiet) {
      console.log(
        `StakeManager validatorRewardPct already ${formatPercent(current)}`
      );
    }
  }

  const unbondingPeriod = parseInteger(
    config.unbondingPeriodSeconds,
    'stakeManager.unbondingPeriodSeconds'
  );
  if (unbondingPeriod !== undefined) {
    const current = await stakeManager.unbondingPeriod();
    if (current !== unbondingPeriod) {
      actions.push({
        contract: stakeManager,
        method: 'setUnbondingPeriod',
        args: [unbondingPeriod],
        description: 'Update StakeManager unbonding period',
        current: formatSeconds(current),
        desired: formatSeconds(unbondingPeriod),
      });
    } else if (!options.quiet) {
      console.log(
        `StakeManager unbondingPeriod already ${formatSeconds(current)}`
      );
    }
  }

  const maxStakePerAddress = parseTokenAmount(
    config.maxStakePerAddressTokens,
    'stakeManager.maxStakePerAddressTokens'
  );
  if (maxStakePerAddress !== undefined) {
    const current = await stakeManager.maxStakePerAddress();
    if (current !== maxStakePerAddress) {
      actions.push({
        contract: stakeManager,
        method: 'setMaxStakePerAddress',
        args: [maxStakePerAddress],
        description: 'Update StakeManager max stake per address',
        current: formatTokenAmount(current),
        desired: formatTokenAmount(maxStakePerAddress),
      });
    } else if (!options.quiet) {
      console.log(
        `StakeManager maxStakePerAddress already ${formatTokenAmount(current)}`
      );
    }
  }

  if (config.stakeRecommendations) {
    const minRec = parseTokenAmount(
      config.stakeRecommendations.minTokens,
      'stakeManager.stakeRecommendations.minTokens'
    );
    const maxRec = parseTokenAmount(
      config.stakeRecommendations.maxTokens,
      'stakeManager.stakeRecommendations.maxTokens'
    );
    if (minRec !== undefined || maxRec !== undefined) {
      const currentMin = await stakeManager.minStake();
      const currentMax = await stakeManager.maxStakePerAddress();
      const desiredMin = minRec ?? currentMin;
      const desiredMax = maxRec ?? currentMax;
      if (currentMin !== desiredMin || currentMax !== desiredMax) {
        actions.push({
          contract: stakeManager,
          method: 'setStakeRecommendations',
          args: [desiredMin, desiredMax],
          description: 'Update StakeManager stake recommendations',
          current: `${formatTokenAmount(currentMin)} min / ${formatTokenAmount(
            currentMax
          )} max`,
          desired: `${formatTokenAmount(desiredMin)} min / ${formatTokenAmount(
            desiredMax
          )} max`,
        });
      } else if (!options.quiet) {
        console.log(
          `StakeManager stake recommendations already ${formatTokenAmount(
            currentMin
          )} min / ${formatTokenAmount(currentMax)} max`
        );
      }
    }
  }

  return actions;
}

async function planFeePoolActions(
  signer: Signer,
  config: FeePoolConfig,
  options: CliOptions
): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];
  const feePool = await connectContract(
    'FeePool',
    ensureAddress(config.address, 'feePool.address'),
    signer
  );

  const burnPct = parsePercent(config.burnPct, 'feePool.burnPct');
  if (burnPct !== undefined) {
    const current = await feePool.burnPct();
    if (current !== burnPct) {
      actions.push({
        contract: feePool,
        method: 'setBurnPct',
        args: [burnPct],
        description: 'Update FeePool burn percentage',
        current: formatPercent(current),
        desired: formatPercent(burnPct),
      });
    } else if (!options.quiet) {
      console.log(`FeePool burnPct already ${formatPercent(current)}`);
    }
  }

  const treasury = normaliseOptionalAddress(config.treasury);
  if (treasury !== undefined) {
    const current = await feePool.treasury();
    if (!sameAddress(current, treasury)) {
      actions.push({
        contract: feePool,
        method: 'setTreasury',
        args: [treasury],
        description: 'Update FeePool treasury',
        current: formatAddress(current),
        desired: formatAddress(treasury),
      });
    } else if (!options.quiet) {
      console.log(`FeePool treasury already ${formatAddress(current)}`);
    }
  }

  if (Array.isArray(config.treasuryAllowlist)) {
    for (const update of config.treasuryAllowlist) {
      const treasuryAddress = ensureAddress(
        update.address,
        'feePool.treasuryAllowlist.address'
      );
      const desired = Boolean(update.allowed);
      const current = await feePool.treasuryAllowlist(treasuryAddress);
      if (current !== desired) {
        actions.push({
          contract: feePool,
          method: 'setTreasuryAllowlist',
          args: [treasuryAddress, desired],
          description: `Update FeePool treasury allowlist for ${treasuryAddress}`,
          current: current ? 'allowed' : 'blocked',
          desired: desired ? 'allowed' : 'blocked',
        });
      } else if (!options.quiet) {
        console.log(
          `FeePool treasury allowlist already ${
            desired ? 'allows' : 'blocks'
          } ${treasuryAddress}`
        );
      }
    }
  }

  return actions;
}

async function planTaxPolicyActions(
  signer: Signer,
  config: TaxPolicyConfig,
  options: CliOptions
): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];
  const taxPolicy = await connectContract(
    'TaxPolicy',
    ensureAddress(config.address, 'taxPolicy.address'),
    signer
  );

  const desiredPolicy =
    config.policy ||
    (config.policyURI && config.acknowledgement
      ? { uri: config.policyURI, acknowledgement: config.acknowledgement }
      : undefined);

  if (desiredPolicy) {
    const currentUri: string = await taxPolicy.policyURI();
    const currentAck: string = await taxPolicy.acknowledgement();
    if (
      currentUri !== desiredPolicy.uri ||
      currentAck !== desiredPolicy.acknowledgement
    ) {
      actions.push({
        contract: taxPolicy,
        method: 'setPolicy',
        args: [desiredPolicy.uri, desiredPolicy.acknowledgement],
        description: 'Update tax policy URI and acknowledgement text',
        current: `${currentUri} | ${currentAck}`,
        desired: `${desiredPolicy.uri} | ${desiredPolicy.acknowledgement}`,
      });
    } else if (!options.quiet) {
      console.log('TaxPolicy URI and acknowledgement already match config');
    }
  } else {
    if (config.policyURI) {
      const currentUri: string = await taxPolicy.policyURI();
      if (currentUri !== config.policyURI) {
        actions.push({
          contract: taxPolicy,
          method: 'setPolicyURI',
          args: [config.policyURI],
          description: 'Update tax policy URI',
          current: currentUri,
          desired: config.policyURI,
        });
      } else if (!options.quiet) {
        console.log('TaxPolicy URI already matches config');
      }
    }
    if (config.acknowledgement) {
      const currentAck: string = await taxPolicy.acknowledgement();
      if (currentAck !== config.acknowledgement) {
        actions.push({
          contract: taxPolicy,
          method: 'setAcknowledgement',
          args: [config.acknowledgement],
          description: 'Update tax acknowledgement text',
          current: currentAck,
          desired: config.acknowledgement,
        });
      } else if (!options.quiet) {
        console.log('TaxPolicy acknowledgement already matches config');
      }
    }
  }

  if (Array.isArray(config.acknowledgers)) {
    for (const update of config.acknowledgers) {
      const address = ensureAddress(
        update.address,
        'taxPolicy.acknowledgers.address'
      );
      const desired = Boolean(update.allowed);
      const filter = taxPolicy.filters?.AcknowledgerUpdated?.(address, null);
      let current = false;
      if (filter) {
        try {
          const events = await taxPolicy.queryFilter(filter, 0, 'latest');
          const last = events.at(-1);
          if (
            last &&
            Array.isArray(last.args) &&
            typeof last.args[1] === 'boolean'
          ) {
            current = last.args[1];
          }
        } catch (eventError) {
          console.warn(
            `Warning: could not query acknowledger history for ${address}: ${
              (eventError as Error).message
            }`
          );
        }
      }
      if (current !== desired) {
        actions.push({
          contract: taxPolicy,
          method: 'setAcknowledger',
          args: [address, desired],
          description: `Update tax acknowledger permission for ${address}`,
          current: current ? 'allowed' : 'blocked',
          desired: desired ? 'allowed' : 'blocked',
        });
      } else if (!options.quiet) {
        console.log(
          `TaxPolicy acknowledger already ${
            desired ? 'allows' : 'blocks'
          } ${address}`
        );
      }
    }
  }

  return actions;
}

async function executeActions(actions: PlannedAction[], execute: boolean) {
  if (actions.length === 0) {
    console.log('No changes required. All parameters match the configuration.');
    return;
  }

  console.log(`Planned ${actions.length} action(s) on network ${network.name}`);
  for (const [index, action] of actions.entries()) {
    console.log(`\n[${index + 1}/${actions.length}] ${action.description}`);
    if (action.current !== undefined) {
      console.log(`  Current: ${action.current}`);
    }
    if (action.desired !== undefined) {
      console.log(`  Desired: ${action.desired}`);
    }
    console.log(
      `  Method: ${action.contract.target}.${action.method}(${action.args
        .map((arg) =>
          typeof arg === 'bigint'
            ? arg.toString()
            : typeof arg === 'string'
            ? arg
            : typeof arg === 'boolean'
            ? arg
              ? 'true'
              : 'false'
            : JSON.stringify(arg)
        )
        .join(', ')})`
    );
  }

  if (!execute) {
    console.log(
      '\nDry run complete. Re-run with --execute to apply these updates.'
    );
    return;
  }

  console.log('\nExecuting actions...');
  for (const [index, action] of actions.entries()) {
    console.log(
      `Sending ${index + 1}/${actions.length}: ${action.description}`
    );
    const tx = await (action.contract as any)[action.method](...action.args);
    console.log(`  Tx hash: ${tx.hash}`);
    await tx.wait(1);
    console.log('  Confirmed');
  }
  console.log('\nAll updates confirmed.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig(options.configPath);
  const signer = (await ethers.getSigners())[0];
  if (!signer) {
    throw new Error(
      'No signer available. Check MAINNET_PRIVATE_KEY or selected network credentials.'
    );
  }
  const actions: PlannedAction[] = [];

  if (config.jobRegistry) {
    actions.push(
      ...(await planJobRegistryActions(signer, config.jobRegistry, options))
    );
  }
  if (config.stakeManager) {
    actions.push(
      ...(await planStakeManagerActions(signer, config.stakeManager, options))
    );
  }
  if (config.feePool) {
    actions.push(
      ...(await planFeePoolActions(signer, config.feePool, options))
    );
  }
  if (config.taxPolicy) {
    actions.push(
      ...(await planTaxPolicyActions(signer, config.taxPolicy, options))
    );
  }

  await executeActions(actions, options.execute);
}

main().catch((error) => {
  console.error('Governance update failed:', error);
  process.exit(1);
});
