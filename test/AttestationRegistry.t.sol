// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import {AttestationRegistry, ZeroAddress} from "../../contracts/AttestationRegistry.sol";
import {IdentityRegistry} from "../../contracts/IdentityRegistry.sol";
import {IENS} from "../../contracts/interfaces/IENS.sol";
import {INameWrapper} from "../../contracts/interfaces/INameWrapper.sol";
import {IReputationEngine} from "../../contracts/interfaces/IReputationEngine.sol";
import {MockENS} from "../../contracts/mocks/legacy/MockENS.sol";
import {MockNameWrapper} from "../../contracts/mocks/legacy/MockNameWrapper.sol";

contract AttestationRegistryTest is Test {
    AttestationRegistry attest;
    IdentityRegistry identity;
    MockENS ens;
    MockNameWrapper wrapper;
    address owner = address(0x1);
    address agent = address(0x2);
    address validator = address(0x3);

    function setUp() public {
        ens = new MockENS();
        wrapper = new MockNameWrapper();
        attest = new AttestationRegistry(IENS(address(ens)), INameWrapper(address(wrapper)));
        identity = new IdentityRegistry(
            IENS(address(ens)),
            INameWrapper(address(wrapper)),
            IReputationEngine(address(0)),
            bytes32(0),
            bytes32(0)
        );
        identity.setAttestationRegistry(address(attest));
    }

    function _node(string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes32(0), keccak256(bytes(label))));
    }

    function testAttestAndRevoke() public {
        bytes32 node = _node("alice");
        wrapper.setOwner(uint256(node), owner);
        vm.prank(owner);
        attest.attest(node, AttestationRegistry.Role.Agent, agent);
        assertTrue(attest.isAttested(node, AttestationRegistry.Role.Agent, agent));
        vm.prank(owner);
        attest.revoke(node, AttestationRegistry.Role.Agent, agent);
        assertFalse(attest.isAttested(node, AttestationRegistry.Role.Agent, agent));
    }

    function testAttestZeroAddressReverts() public {
        bytes32 node = _node("alice");
        wrapper.setOwner(uint256(node), owner);
        vm.expectRevert(ZeroAddress.selector);
        vm.prank(owner);
        attest.attest(node, AttestationRegistry.Role.Agent, address(0));
    }

    function testIdentityIntegration() public {
        bytes32 aNode = _node("agent");
        wrapper.setOwner(uint256(aNode), owner);
        vm.prank(owner);
        attest.attest(aNode, AttestationRegistry.Role.Agent, agent);
        assertTrue(identity.isAuthorizedAgent(agent, "agent", new bytes32[](0)));

        bytes32 vNode = _node("validator");
        wrapper.setOwner(uint256(vNode), owner);
        vm.prank(owner);
        attest.attest(vNode, AttestationRegistry.Role.Validator, validator);
        assertTrue(identity.isAuthorizedValidator(validator, "validator", new bytes32[](0)));
    }

    function testSetENSUnauthorized() public {
        address caller = address(0xBEEF);
        vm.expectRevert(
            abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", caller)
        );
        vm.prank(caller);
        attest.setENS(address(ens));
    }

    function testSetNameWrapperUnauthorized() public {
        address caller = address(0xBEEF);
        vm.expectRevert(
            abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", caller)
        );
        vm.prank(caller);
        attest.setNameWrapper(address(wrapper));
    }
}

