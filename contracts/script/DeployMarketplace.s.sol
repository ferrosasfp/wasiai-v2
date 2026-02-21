// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/WasiAIMarketplace.sol";

/**
 * @title  DeployMarketplace
 * @notice Deploys WasiAIMarketplace on Avalanche C-Chain (mainnet or Fuji).
 *
 * Usage:
 *
 *   # Fuji testnet (always start here)
 *   forge script script/DeployMarketplace.s.sol \
 *     --rpc-url fuji \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast -vvv
 *
 *   # Mainnet (when ready)
 *   forge script script/DeployMarketplace.s.sol \
 *     --rpc-url avalanche \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast --verify -vvv
 *
 * Required env vars:
 *   PRIVATE_KEY           → deployer wallet private key WITH 0x prefix, e.g. 0xabc123...
 *   WASIAI_TREASURY       → wallet that receives the 10% platform fee
 *   OPERATOR_ADDRESS      → backend server wallet that can call recordInvocation
 *
 * USDC addresses (auto-selected by chainId):
 *   Fuji mainnet:  0x5425890298aed601595a70AB815c96711a31Bc65 (test USDC)
 *   Avalanche:     0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E (native USDC)
 */
contract DeployMarketplace is Script {
    // Avalanche C-Chain USDC (native)
    address constant USDC_MAINNET = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
    // Avalanche Fuji testnet USDC (faucet available at faucet.circle.com)
    address constant USDC_FUJI    = 0x5425890298aed601595a70AB815c96711a31Bc65;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer           = vm.addr(deployerPrivateKey);
        address treasury           = vm.envAddress("WASIAI_TREASURY");
        address operator           = vm.envOr("OPERATOR_ADDRESS", deployer);

        // Select USDC by network
        uint256 chainId = block.chainid;
        address usdc;
        if (chainId == 43114) {
            usdc = USDC_MAINNET;
            console.log("Network: Avalanche C-Chain (mainnet)");
        } else if (chainId == 43113) {
            usdc = USDC_FUJI;
            console.log("Network: Avalanche Fuji (testnet)");
        } else {
            revert("Unsupported chain - use Avalanche or Fuji");
        }

        console.log("Deployer:", deployer);
        console.log("Treasury:", treasury);
        console.log("Operator:", operator);
        console.log("USDC:    ", usdc);

        vm.startBroadcast(deployerPrivateKey);

        WasiAIMarketplace marketplace = new WasiAIMarketplace(usdc, treasury);

        // Grant backend operator role (separate from owner)
        if (operator != deployer) {
            marketplace.setOperator(operator, true);
        }

        console.log("");
        console.log("=== DEPLOYMENT SUCCESSFUL ===");
        console.log("WasiAIMarketplace:", address(marketplace));
        console.log("Platform fee:     ", marketplace.platformFeeBps(), "bps (10%)");
        console.log("");
        console.log("Next steps:");
        console.log("  1. Add to .env.local: MARKETPLACE_CONTRACT_ADDRESS=", address(marketplace));
        console.log("  2. Add to .env.local: NEXT_PUBLIC_MARKETPLACE_ADDRESS=", address(marketplace));
        console.log("  3. Fund OPERATOR_ADDRESS with AVAX for gas (small amount)");
        console.log("  4. Run migration 006 in Supabase");

        vm.stopBroadcast();
    }
}
