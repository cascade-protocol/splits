import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
/**
 * Wagmi config for Base mainnet.
 */
export const wagmiConfig = createConfig({
	chains: [base],
	multiInjectedProviderDiscovery: true,
	transports: {
		[base.id]: http(
			"https://api.developer.coinbase.com/rpc/v1/base/b7WGeCTTy4K6ZWJA0PUi5TXRVllE4eDX",
		),
	},
});

// TypeScript: Register wagmi config for type inference
declare module "wagmi" {
	interface Register {
		config: typeof wagmiConfig;
	}
}
