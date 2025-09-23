// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {AGIALPHAToken} from "../../contracts/test/AGIALPHAToken.sol";
import {AGIALPHA} from "../../contracts/Constants.sol";
import {StakeManager} from "../../contracts/StakeManager.sol";
import {
    PlatformRegistry,
    IReputationEngine as PlatformReputationEngine
} from "../../contracts/PlatformRegistry.sol";
import {JobRouter} from "../../contracts/modules/JobRouter.sol";
import {IPlatformRegistryFull} from "../../contracts/interfaces/IPlatformRegistryFull.sol";
import {IJobRouter} from "../../contracts/interfaces/IJobRouter.sol";
import {IPlatformRegistry} from "../../contracts/interfaces/IPlatformRegistry.sol";
import {FeePool} from "../../contracts/FeePool.sol";
import {PlatformIncentives} from "../../contracts/PlatformIncentives.sol";
import {MockJobRegistry} from "../../contracts/mocks/MockV2.sol";
import {IStakeManager} from "../../contracts/interfaces/IStakeManager.sol";
import {ITaxPolicy} from "../../contracts/interfaces/ITaxPolicy.sol";

contract PlatformIncentivesTest is Test {
    AGIALPHAToken token;
    StakeManager stakeManager;
    PlatformRegistry platformRegistry;
    JobRouter jobRouter;
    FeePool feePool;
    PlatformIncentives incentives;
    MockJobRegistry jobRegistry;

    address operator = address(0xBEEF);

    function setUp() public {
        AGIALPHAToken impl = new AGIALPHAToken();
        vm.etch(AGIALPHA, address(impl).code);
        token = AGIALPHAToken(payable(AGIALPHA));
        jobRegistry = new MockJobRegistry();
        jobRegistry.setTaxPolicyVersion(1);
        stakeManager = new StakeManager(0, 0, 0, address(this), address(jobRegistry), address(0), address(this));
        platformRegistry = new PlatformRegistry(
            IStakeManager(address(stakeManager)),
            PlatformReputationEngine(address(0)),
            1e18
        );
        jobRouter = new JobRouter(IPlatformRegistry(address(platformRegistry)));
        feePool = new FeePool(
            IStakeManager(address(stakeManager)),
            0,
            address(this),
            ITaxPolicy(address(0))
        );
        incentives = new PlatformIncentives(
            IStakeManager(address(stakeManager)),
            IPlatformRegistryFull(address(platformRegistry)),
            IJobRouter(address(jobRouter))
        );
        platformRegistry.setRegistrar(address(incentives), true);
        jobRouter.setRegistrar(address(incentives), true);

        token.mint(operator, 20e18);
        vm.startPrank(operator);
        jobRegistry.acknowledgeTaxPolicy();
        token.approve(address(stakeManager), type(uint256).max);
        vm.stopPrank();
    }

    function testStakeAndActivate() public {
        vm.prank(operator);
        incentives.stakeAndActivate(10e18);
        assertEq(stakeManager.stakeOf(operator, StakeManager.Role.Platform), 10e18);
        assertTrue(platformRegistry.registered(operator));
        assertTrue(jobRouter.registered(operator));

        incentives.stakeAndActivate(0);
        assertTrue(platformRegistry.registered(address(this)));
        assertTrue(jobRouter.registered(address(this)));
        assertEq(platformRegistry.getScore(address(this)), 0);
        assertEq(jobRouter.routingWeight(address(this)), 0);

        token.mint(address(this), 5e18);
        token.transfer(address(feePool), 5e18);
        vm.prank(address(stakeManager));
        feePool.depositFee(5e18);
        feePool.distributeFees();

        uint256 before = token.balanceOf(operator);
        vm.prank(operator);
        feePool.claimRewards();
        assertEq(token.balanceOf(operator) - before, 5e18);

        uint256 ownerBefore = token.balanceOf(address(this));
        vm.expectEmit(true, false, false, true, address(feePool));
        emit FeePool.RewardsClaimed(address(this), 0);
        feePool.claimRewards();
        assertEq(token.balanceOf(address(this)) - ownerBefore, 0);
    }

    function testStakeZeroRevertsForNonOwner() public {
        vm.prank(operator);
        vm.expectRevert(bytes("amount"));
        incentives.stakeAndActivate(0);
    }
}
