// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import {ValidationModule} from "../../contracts/ValidationModule.sol";
import {StakeManager} from "../../contracts/StakeManager.sol";
import {IdentityRegistryToggle} from "../../contracts/mocks/IdentityRegistryToggle.sol";
import {AGIALPHAToken} from "../../contracts/test/AGIALPHAToken.sol";
import {IJobRegistry} from "../../contracts/interfaces/IJobRegistry.sol";
import {IStakeManager} from "../../contracts/interfaces/IStakeManager.sol";
import {IIdentityRegistry} from "../../contracts/interfaces/IIdentityRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockJobRegistry} from "../../contracts/mocks/MockV2.sol";
import {AGIALPHA} from "../../contracts/Constants.sol";

contract ValidationSlashingFuzz is Test {
    ValidationModule validation;
    StakeManager stake;
    IdentityRegistryToggle identity;
    AGIALPHAToken token;
    MockJobRegistry jobRegistry;

    function setUp() public {
        AGIALPHAToken impl = new AGIALPHAToken();
        vm.etch(AGIALPHA, address(impl).code);
        token = AGIALPHAToken(payable(AGIALPHA));
        stake = new StakeManager(1e18, 0, 100, address(this), address(0), address(0), address(this));
        jobRegistry = new MockJobRegistry();
        stake.setJobRegistry(address(jobRegistry));
        identity = new IdentityRegistryToggle();
        validation = new ValidationModule(
            IJobRegistry(address(0)),
            IStakeManager(address(stake)),
            1,
            1,
            1,
            10,
            new address[](0)
        );
        validation.setIdentityRegistry(IIdentityRegistry(address(identity)));
    }

    function testFuzz_slashingPercentage(uint8 pct) public {
        pct = uint8(bound(uint256(pct), 0, 100));
        validation.setValidatorSlashingPct(pct);
        assertEq(validation.validatorSlashingPercentage(), pct);
    }

    function testFuzz_validatorPool(uint8 size) public {
        size = uint8(bound(uint256(size), 0, 10));
        address[] memory pool = new address[](size);
        for (uint8 i; i < size; i++) {
            address val = address(uint160(uint256(keccak256(abi.encode(i + 1)))));
            pool[i] = val;
            identity.addAdditionalValidator(val);
            token.mint(val, 1e18);
            vm.prank(val);
            token.approve(address(stake), 1e18);
            vm.prank(val);
            stake.depositStake(StakeManager.Role.Validator, 1e18);
        }
        validation.setValidatorPool(pool);
        for (uint8 i; i < size; i++) {
            assertEq(validation.validatorPool(i), pool[i]);
        }
    }
}

