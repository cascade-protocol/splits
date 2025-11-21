// Mock split configurations matching SDK types
export interface MockSplit {
	id: string;
	name: string;
	vault: string;
	recipients: Array<{
		address: string;
		share: number; // 1-99
	}>;
	balance: number; // Current balance in vault (in tokens, e.g., USDC)
	token: string;
	status: "empty" | "ready" | "executed";
}

export const mockSplits: MockSplit[] = [
	{
		id: "1",
		name: "Team Revenue",
		vault: "8yTz4mK2pF9vQr3nLx7Hs5Kp2Jw6Rt8Bm4Cv9Xz1Aq3",
		recipients: [
			{
				address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
				share: 60,
			},
			{
				address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
				share: 40,
			},
		],
		balance: 2340,
		token: "USDC",
		status: "ready",
	},
	{
		id: "2",
		name: "Creator Collab",
		vault: "3kLm9Wx4Pv7Yq2Hs5Kp8Rt6Bm3Cv1Xz9Jw4Aq7Nf2Lx5",
		recipients: [
			{
				address: "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK",
				share: 50,
			},
			{
				address: "BvzKvn6nUUAYtKu2pH3h5SbUkUNcRPQawg4bURBiojJx",
				share: 30,
			},
			{
				address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
				share: 20,
			},
		],
		balance: 0,
		token: "USDC",
		status: "empty",
	},
	{
		id: "3",
		name: "Marketplace Payouts",
		vault: "7nPw2Km8Qv4Rx6Hs9Kp5Jw3Cv2Bm7Xz1Aq4Rt8Lx6Yz3",
		recipients: [
			{
				address: "6XTb4qPKLqHv9o3K8dHZfg5QvWcYb8Zw7Fk2Yx4Jm9Hq",
				share: 85,
			},
			{
				address: "J83w4HKfqxwkUw7VUTNSdCUY2HMF1x1B6VbRAoqvn1zc",
				share: 15,
			},
		],
		balance: 890,
		token: "USDC",
		status: "ready",
	},
];

// Example split for landing page
export const exampleSplit: MockSplit = {
	id: "example",
	name: "Example Split",
	vault: "5Hs8Kp3Jw9Cv6Bm2Xz7Aq1Rt4Lx8Yz5Nf6Pv3Qv9Wx2",
	recipients: [
		{
			address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
			share: 60,
		},
		{
			address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
			share: 40,
		},
	],
	balance: 1000,
	token: "USDC",
	status: "ready",
};
