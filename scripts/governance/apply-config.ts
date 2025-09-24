import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

interface ModuleConfig {
  name: string;
  script: string;
  args?: string[];
  description?: string;
  optional?: boolean;
}

interface GovernanceControl {
  modules: ModuleConfig[];
}

interface CliOptions {
  configPath?: string;
  network?: string;
  execute: boolean;
  modules?: string[];
  skip?: string[];
  list?: boolean;
  help?: boolean;
  quiet?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { execute: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--config': {
        const value = argv[i + 1];
        if (!value) {
          throw new Error('--config requires a file path');
        }
        options.configPath = value;
        i += 1;
        break;
      }
      case '--network': {
        const value = argv[i + 1];
        if (!value) {
          throw new Error('--network requires a value');
        }
        options.network = value;
        i += 1;
        break;
      }
      case '--module':
      case '--only': {
        const value = argv[i + 1];
        if (!value) {
          throw new Error(`${arg} requires a module name`);
        }
        if (!options.modules) {
          options.modules = [];
        }
        options.modules.push(value);
        i += 1;
        break;
      }
      case '--skip': {
        const value = argv[i + 1];
        if (!value) {
          throw new Error('--skip requires a module name');
        }
        if (!options.skip) {
          options.skip = [];
        }
        options.skip.push(value);
        i += 1;
        break;
      }
      case '--execute': {
        options.execute = true;
        break;
      }
      case '--quiet': {
        options.quiet = true;
        break;
      }
      case '--list': {
        options.list = true;
        break;
      }
      case '--help':
      case '-h': {
        options.help = true;
        break;
      }
      default: {
        throw new Error(`Unknown argument: ${arg}`);
      }
    }
  }
  return options;
}

function normaliseModuleName(name: string): string {
  return name.trim().toLowerCase();
}

function loadGovernanceControl(configPath: string): GovernanceControl {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Governance control config not found at ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.modules)) {
    throw new Error('governance-control config must contain a modules array');
  }
  return parsed as GovernanceControl;
}

function resolveHardhatBinary(repoRoot: string): string {
  const binaryName = process.platform === 'win32' ? 'hardhat.cmd' : 'hardhat';
  const candidate = path.join(repoRoot, 'node_modules', '.bin', binaryName);
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `Hardhat binary not found at ${candidate}. Run "npm install" before executing this script.`
    );
  }
  return candidate;
}

function formatModule(module: ModuleConfig): string {
  const details = [module.name];
  if (module.description) {
    details.push(`- ${module.description}`);
  }
  return details.join(' ');
}

async function main() {
  try {
    const argv = process.argv.slice(2);
    const options = parseArgs(argv);

    if (options.help) {
      console.log(
        `Usage: ts-node scripts/governance/apply-config.ts [options]\n\n` +
          'Options:\n' +
          '  --config <path>   Path to governance-control.json (default: config/governance-control.json)\n' +
          '  --network <name>  Hardhat network name to forward to each module script\n' +
          '  --module <name>   Only run the specified module (can be repeated)\n' +
          '  --skip <name>     Skip the specified module (can be repeated)\n' +
          '  --execute         Apply changes instead of performing a dry run\n' +
          '  --quiet           Reduce log verbosity\n' +
          '  --list            List modules and exit\n' +
          '  -h, --help        Show this help message\n'
      );
      return;
    }

    const repoRoot = path.resolve(__dirname, '..', '..');
    const defaultConfig = path.join(
      repoRoot,
      'config',
      'governance-control.json'
    );
    const configPath = options.configPath
      ? path.resolve(process.cwd(), options.configPath)
      : defaultConfig;

    const control = loadGovernanceControl(configPath);
    const modules = control.modules || [];

    if (modules.length === 0) {
      console.log(
        'No modules declared in governance-control config. Nothing to do.'
      );
      return;
    }

    const moduleFilter = options.modules
      ? new Set(options.modules.map(normaliseModuleName))
      : undefined;
    const skipFilter = options.skip
      ? new Set(options.skip.map(normaliseModuleName))
      : new Set<string>();

    const selectedModules = modules.filter((module) => {
      const normalized = normaliseModuleName(module.name);
      if (moduleFilter && !moduleFilter.has(normalized)) {
        return false;
      }
      if (skipFilter.has(normalized)) {
        return false;
      }
      return true;
    });

    if (options.list) {
      console.log(`Loaded ${modules.length} module(s) from ${configPath}`);
      modules.forEach((module) => {
        console.log(`- ${formatModule(module)}`);
      });
      if (moduleFilter) {
        console.log('\nFiltered selection:');
        selectedModules.forEach((module) => {
          console.log(`- ${module.name}`);
        });
      }
      return;
    }

    if (selectedModules.length === 0) {
      console.log('No modules matched the provided filters. Nothing to run.');
      return;
    }

    const hardhatBin = resolveHardhatBinary(repoRoot);
    const modeLabel = options.execute ? 'EXECUTE' : 'DRY-RUN';

    if (!options.quiet) {
      console.log(`Owner control orchestrator (${modeLabel})`);
      console.log(`Config: ${configPath}`);
      if (options.network) {
        console.log(`Network: ${options.network}`);
      }
      console.log(`Selected modules (${selectedModules.length}):`);
      selectedModules.forEach((module, index) => {
        const prefix = `${index + 1}.`;
        console.log(`  ${prefix} ${formatModule(module)}`);
      });
    }

    for (const module of selectedModules) {
      const scriptPath = path.resolve(repoRoot, module.script);
      if (!fs.existsSync(scriptPath)) {
        if (module.optional) {
          if (!options.quiet) {
            console.warn(
              `Skipping optional module ${module.name} because script ${scriptPath} does not exist.`
            );
          }
          continue;
        }
        throw new Error(
          `Module ${module.name} references missing script ${scriptPath}. Update config/governance-control.json or restore the script.`
        );
      }

      if (!options.quiet) {
        console.log(`\n>>> Running ${module.name} (${module.script})`);
      }

      const args: string[] = ['run', scriptPath];
      if (options.network) {
        args.push('--network', options.network);
      }
      if (Array.isArray(module.args) && module.args.length > 0) {
        args.push(...module.args);
      }
      if (options.execute) {
        args.push('--execute');
      }

      const result = spawnSync(hardhatBin, args, {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env },
      });

      if (result.error) {
        throw result.error;
      }
      if (typeof result.status === 'number' && result.status !== 0) {
        throw new Error(
          `${module.name} update script exited with status ${result.status}. Aborting.`
        );
      }
    }

    if (!options.quiet) {
      console.log('\nAll selected modules completed successfully.');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

void main();
