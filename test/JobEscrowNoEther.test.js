const { expect } = require('chai');
const { ethers, artifacts, network } = require('hardhat');

describe('JobEscrow ether rejection', function () {
  const { AGIALPHA, AGIALPHA_DECIMALS } = require('../scripts/constants');
  let owner, employer, operator, token, routing, escrow;

  beforeEach(async () => {
    [owner, employer, operator] = await ethers.getSigners();

    const artifact = await artifacts.readArtifact(
      'contracts/test/MockERC20.sol:MockERC20'
    );
    await network.provider.send('hardhat_setCode', [
      AGIALPHA,
      artifact.deployedBytecode,
    ]);
    token = await ethers.getContractAt(
      'contracts/test/AGIALPHAToken.sol:AGIALPHAToken',
      AGIALPHA
    );
    const initialBalance = ethers.parseUnits('1', AGIALPHA_DECIMALS);
    await token.mint(employer.address, initialBalance);

    const Routing = await ethers.getContractFactory(
      'contracts/mocks/legacy/MockRoutingModule.sol:MockRoutingModule'
    );
    routing = await Routing.deploy(operator.address);

    const Escrow = await ethers.getContractFactory(
      'contracts/modules/JobEscrow.sol:JobEscrow'
    );
    escrow = await Escrow.deploy(await routing.getAddress());
  });

  it('reverts on direct ether transfer', async () => {
    await expect(
      owner.sendTransaction({ to: await escrow.getAddress(), value: 1 })
    ).to.be.revertedWithCustomError(escrow, 'NoEther');
  });

  it('reverts on unknown calldata with value', async () => {
    await expect(
      owner.sendTransaction({
        to: await escrow.getAddress(),
        data: '0x12345678',
        value: 1,
      })
    ).to.be.revertedWithCustomError(escrow, 'NoEther');
  });

  it('reports tax exemption for owner and helper', async () => {
    expect(await escrow.isTaxExempt()).to.equal(true);

    const Helper = await ethers.getContractFactory(
      'contracts/mocks/legacy/TaxExemptHelper.sol:TaxExemptHelper'
    );
    const helper = await Helper.deploy();
    expect(await helper.check(await escrow.getAddress())).to.equal(true);
  });
});
