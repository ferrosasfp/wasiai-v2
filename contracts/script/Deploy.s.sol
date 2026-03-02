// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/WasiAIMarketplace.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("OPERATOR_PRIVATE_KEY");
        address treasury    = vm.envAddress("WASIAI_TREASURY_ADDRESS");
        address usdc        = vm.envAddress("WASIAI_USDC_ADDRESS");

        vm.startBroadcast(deployerKey);
        WasiAIMarketplace marketplace = new WasiAIMarketplace(usdc, treasury);
        vm.stopBroadcast();

        console.log("WasiAIMarketplace v8 deployed at:", address(marketplace));
    }
}
