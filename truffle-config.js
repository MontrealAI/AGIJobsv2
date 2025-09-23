require('dotenv').config();
const HDWalletProvider = require('@truffle/hdwallet-provider');

const { MNEMONIC, PK, INFURA_KEY, ETHERSCAN_API_KEY, GAS_PRICE_GWEI } =
  process.env;

function makeProvider(url, chainId) {
  return () => {
    if (!PK && !MNEMONIC) {
      throw new Error('Set PK or MNEMONIC in the environment');
    }
    const options = {
      providerOrUrl: url,
      pollingInterval: 8000,
      chainId,
    };
    if (PK) {
      options.privateKeys = [PK];
    } else {
      options.mnemonic = MNEMONIC;
    }
    return new HDWalletProvider(options);
  };
}

function gasPrice(defaultGwei) {
  const gwei = GAS_PRICE_GWEI ? Number(GAS_PRICE_GWEI) : defaultGwei;
  return Math.floor(gwei * 1e9);
}

module.exports = {
  contracts_directory: './truffle/contracts',
  networks: {
    development: {
      host: '127.0.0.1',
      port: 8545,
      network_id: '*',
    },
    sepolia: {
      provider: makeProvider(
        `https://sepolia.infura.io/v3/${INFURA_KEY}`,
        11155111
      ),
      network_id: 11155111,
      gasPrice: gasPrice(5),
      confirmations: 2,
      timeoutBlocks: 500,
      skipDryRun: true,
    },
    mainnet: {
      provider: makeProvider(`https://mainnet.infura.io/v3/${INFURA_KEY}`, 1),
      network_id: 1,
      gasPrice: gasPrice(30),
      confirmations: 2,
      timeoutBlocks: 500,
      skipDryRun: true,
    },
  },
  mocha: {
    timeout: 200000,
  },
  test_directory: './truffle/test',
  compilers: {
    solc: {
      version: '0.8.25',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
        evmVersion: 'paris',
        viaIR: true,
      },
    },
  },
  plugins: ['truffle-plugin-verify'],
  api_keys: {
    etherscan: ETHERSCAN_API_KEY,
  },
};
