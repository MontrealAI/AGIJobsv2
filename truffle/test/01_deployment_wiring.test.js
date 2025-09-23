const StakeManager = artifacts.require('StakeManager');
const JobRegistry = artifacts.require('JobRegistry');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const CertificateNFT = artifacts.require('CertificateNFT');
const FeePool = artifacts.require('FeePool');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const ReputationEngine = artifacts.require('ReputationEngine');
const TaxPolicy = artifacts.require('TaxPolicy');

contract('Deployment wiring', () => {
  it('links modules and identity registry', async () => {
    const [
      stake,
      job,
      validation,
      dispute,
      cert,
      fee,
      identity,
      reputation,
      tax,
    ] = await Promise.all([
      StakeManager.deployed(),
      JobRegistry.deployed(),
      ValidationModule.deployed(),
      DisputeModule.deployed(),
      CertificateNFT.deployed(),
      FeePool.deployed(),
      IdentityRegistry.deployed(),
      ReputationEngine.deployed(),
      TaxPolicy.deployed().catch(() => null),
    ]);

    assert.equal(
      await stake.jobRegistry(),
      job.address,
      'stakeManager.jobRegistry'
    );
    assert.equal(
      await stake.disputeModule(),
      dispute.address,
      'stakeManager.disputeModule'
    );
    assert.equal(
      await stake.validationModule(),
      validation.address,
      'stakeManager.validationModule'
    );

    assert.equal(
      await validation.jobRegistry(),
      job.address,
      'validationModule.jobRegistry'
    );
    assert.equal(
      await validation.identityRegistry(),
      identity.address,
      'validationModule.identityRegistry'
    );

    assert.equal(
      await dispute.jobRegistry(),
      job.address,
      'disputeModule.jobRegistry'
    );
    assert.equal(
      await dispute.stakeManager(),
      stake.address,
      'disputeModule.stakeManager'
    );

    assert.equal(
      await cert.jobRegistry(),
      job.address,
      'certificateNFT.jobRegistry'
    );
    assert.equal(
      await cert.stakeManager(),
      stake.address,
      'certificateNFT.stakeManager'
    );

    assert.equal(
      await fee.stakeManager(),
      stake.address,
      'feePool.stakeManager'
    );

    assert.equal(
      await job.validationModule(),
      validation.address,
      'jobRegistry.validationModule'
    );
    assert.equal(
      await job.stakeManager(),
      stake.address,
      'jobRegistry.stakeManager'
    );
    assert.equal(
      await job.reputationEngine(),
      reputation.address,
      'jobRegistry.reputationEngine'
    );
    assert.equal(
      await job.disputeModule(),
      dispute.address,
      'jobRegistry.disputeModule'
    );
    assert.equal(
      await job.certificateNFT(),
      cert.address,
      'jobRegistry.certificateNFT'
    );
    assert.equal(await job.feePool(), fee.address, 'jobRegistry.feePool');
    assert.equal(
      await job.identityRegistry(),
      identity.address,
      'jobRegistry.identityRegistry'
    );

    const caller = await reputation.callers(job.address);
    assert.equal(caller, true, 'jobRegistry authorized with reputation engine');

    if (tax) {
      assert.equal(await job.taxPolicy(), tax.address, 'jobRegistry.taxPolicy');
      assert.equal(await fee.taxPolicy(), tax.address, 'feePool.taxPolicy');
    }
  });
});
