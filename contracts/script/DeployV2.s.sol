// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/WasiAIMarketplace.sol";

/**
 * @title  DeployV2
 * @notice Deploy WasiAIMarketplace V2 and register 5 WasiAI agents.
 * @dev    WAS-216: migration script.
 *         - Deploys new contract
 *         - Sets operator
 *         - Batch-registers 5 WasiAI agents via batchSelfRegister
 *         - Verifies all 5 agents on-chain
 *
 *         Required env vars:
 *           TREASURY_PRIVATE_KEY        — treasury wallet (creator of 5 agents in V1)
 *           WASIAI_TREASURY_ADDRESS     — treasury address (0xBF9554c33A8E743518aeD49d1A3c9e175a5f9967)
 *           WASIAI_USDC_ADDRESS         — USDC contract address (0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E on Avalanche C-Chain)
 *           OPERATOR_ADDRESS            — operator address to whitelist
 */
contract DeployV2 is Script {
    function run() external {
        uint256 deployerKey      = vm.envUint("TREASURY_PRIVATE_KEY");
        address treasury         = vm.envAddress("WASIAI_TREASURY_ADDRESS");
        address usdc             = vm.envAddress("WASIAI_USDC_ADDRESS");
        address operatorAddress  = vm.envAddress("OPERATOR_ADDRESS");

        vm.startBroadcast(deployerKey);

        // 1. Deploy WasiAIMarketplace V2
        WasiAIMarketplace marketplace = new WasiAIMarketplace(usdc, treasury);
        console.log("WasiAIMarketplace V2 deployed at:", address(marketplace));

        // 2. Set operator
        marketplace.setOperator(operatorAddress, true);
        console.log("Operator set:", operatorAddress);

        // 3. batchSelfRegister 5 WasiAI agents
        //    msg.sender = treasury wallet (0xBF9554c33A8E743518aeD49d1A3c9e175a5f9967)
        //    Same creator as in V1 mainnet contract
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
        // All 0 — no ERC-8004 identity tokens registered

        marketplace.batchSelfRegister(slugs, prices, erc8004Ids);
        console.log("Registered 5 WasiAI agents via batchSelfRegister");

        vm.stopBroadcast();

        // 4. Verify all 5 agents on-chain
        for (uint256 i = 0; i < slugs.length; i++) {
            WasiAIMarketplace.Agent memory agent = marketplace.getAgent(slugs[i]);
            require(agent.creator != address(0), string(abi.encodePacked("Agent not found: ", slugs[i])));
            console.log("Agent verified:", slugs[i]);
            console.log("  creator:      ", agent.creator);
            console.log("  pricePerCall: ", agent.pricePerCall);
        }

        console.log("===================================");
        console.log("V2 Migration complete.");
        console.log("New contract: ", address(marketplace));
        console.log("Update NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET in Vercel to:", address(marketplace));
        console.log("===================================");
    }
}
