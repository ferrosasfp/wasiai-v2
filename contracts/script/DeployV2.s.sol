// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/WasiAIMarketplace.sol";

/**
 * @title  DeployV2
 * @notice Deploy WasiAIMarketplace V2 and register 5 WasiAI agents.
 * @dev    WAS-216: migration script.
 *         Phase 1 (Owner): deploy contract + set operator
 *         Phase 2 (Treasury): batchSelfRegister 5 agents (treasury = creator)
 *
 *         Required env vars:
 *           OWNER_PRIVATE_KEY           — owner wallet (becomes contract owner via Ownable)
 *           TREASURY_PRIVATE_KEY        — treasury wallet (creator of agents)
 *           WASIAI_TREASURY_ADDRESS     — treasury address
 *           WASIAI_USDC_ADDRESS         — USDC contract address
 *           OPERATOR_ADDRESS            — operator address to whitelist
 */
contract DeployV2 is Script {
    function run() external {
        uint256 ownerKey         = vm.envUint("OWNER_PRIVATE_KEY");
        uint256 treasuryKey      = vm.envUint("TREASURY_PRIVATE_KEY");
        address treasury         = vm.envAddress("WASIAI_TREASURY_ADDRESS");
        address usdc             = vm.envAddress("WASIAI_USDC_ADDRESS");
        address operatorAddress  = vm.envAddress("OPERATOR_ADDRESS");

        // ── Phase 1: Owner deploys + configures ──
        vm.startBroadcast(ownerKey);

        WasiAIMarketplace marketplace = new WasiAIMarketplace(usdc, treasury);
        console.log("WasiAIMarketplace V2 deployed at:", address(marketplace));

        marketplace.setOperator(operatorAddress, true);
        console.log("Operator set:", operatorAddress);

        vm.stopBroadcast();

        // ── Phase 2: Treasury registers agents ──
        vm.startBroadcast(treasuryKey);

        string[] memory slugs = new string[](5);
        slugs[0] = "wasi-chainlink-price";
        slugs[1] = "wasi-contract-auditor";
        slugs[2] = "wasi-defi-sentiment";
        slugs[3] = "wasi-onchain-analyzer";
        slugs[4] = "wasi-risk-report";

        uint256[] memory prices = new uint256[](5);
        prices[0] = 10_000;   // $0.01 USDC
        prices[1] = 100_000;  // $0.10 USDC
        prices[2] = 10_000;   // $0.01 USDC
        prices[3] = 10_000;   // $0.01 USDC
        prices[4] = 10_000;   // $0.01 USDC

        uint64[] memory erc8004Ids = new uint64[](5);
        marketplace.batchSelfRegister(slugs, prices, erc8004Ids);
        console.log("Registered 5 WasiAI agents via batchSelfRegister");

        vm.stopBroadcast();

        // ── Verify ──
        for (uint256 i = 0; i < slugs.length; i++) {
            WasiAIMarketplace.Agent memory agent = marketplace.getAgent(slugs[i]);
            require(agent.creator != address(0), string(abi.encodePacked("Agent not found: ", slugs[i])));
            console.log("Agent verified:", slugs[i]);
            console.log("  creator:      ", agent.creator);
            console.log("  pricePerCall: ", agent.pricePerCall);
        }

        console.log("===================================");
        console.log("V2 Migration complete.");
        console.log("Contract owner:", vm.addr(ownerKey));
        console.log("Agent creator: ", treasury);
        console.log("New contract:  ", address(marketplace));
        console.log("===================================");
    }
}
