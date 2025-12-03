import {
	type Address,
	type Hash,
	type PublicClient,
	getContract,
	isAddress,
} from "viem";
import { splitFactoryAbi, splitConfigImplAbi } from "./abi.js";
import type {
	EvmRecipient,
	EvmRecipientInput,
	EvmSplitConfig,
	EvmExecutionPreview,
} from "./types.js";
import { getUsdcAddress } from "./addresses.js";

/**
 * Convert SDK recipient input to on-chain format.
 */
export function toEvmRecipient(r: EvmRecipientInput): EvmRecipient {
	if (!isAddress(r.address)) {
		throw new Error(`Invalid address: ${r.address}`);
	}

	const bps =
		r.percentageBps ?? (r.share !== undefined ? r.share * 99 : undefined);
	if (bps === undefined) {
		throw new Error("Recipient must have either share or percentageBps");
	}
	return { addr: r.address, percentageBps: bps };
}

/**
 * Convert array of recipients to on-chain format.
 */
export function toEvmRecipients(
	recipients: EvmRecipientInput[],
): EvmRecipient[] {
	return recipients.map(toEvmRecipient);
}

/**
 * Predict the deterministic address of a split before creation.
 */
export async function predictSplitAddress(
	client: PublicClient,
	factoryAddress: Address,
	params: {
		authority: Address;
		token: Address;
		uniqueId: Hash;
		recipients: EvmRecipient[];
	},
): Promise<Address> {
	const factory = getContract({
		address: factoryAddress,
		abi: splitFactoryAbi,
		client,
	});

	return factory.read.predictSplitAddress([
		params.authority,
		params.token,
		params.uniqueId,
		params.recipients,
	]);
}

/**
 * Check if an address is a Cascade Split contract.
 */
export async function isCascadeSplit(
	client: PublicClient,
	address: Address,
): Promise<boolean> {
	try {
		const split = getContract({
			address,
			abi: splitConfigImplAbi,
			client,
		});
		return await split.read.isCascadeSplitConfig();
	} catch {
		return false;
	}
}

/**
 * Get the token balance of a split contract.
 */
export async function getSplitBalance(
	client: PublicClient,
	splitAddress: Address,
): Promise<bigint> {
	const split = getContract({
		address: splitAddress,
		abi: splitConfigImplAbi,
		client,
	});
	return split.read.getBalance();
}

/**
 * Check if a split has pending funds to distribute.
 */
export async function hasPendingFunds(
	client: PublicClient,
	splitAddress: Address,
): Promise<boolean> {
	const split = getContract({
		address: splitAddress,
		abi: splitConfigImplAbi,
		client,
	});
	return split.read.hasPendingFunds();
}

/**
 * Get pending amount available for distribution.
 */
export async function getPendingAmount(
	client: PublicClient,
	splitAddress: Address,
): Promise<bigint> {
	const split = getContract({
		address: splitAddress,
		abi: splitConfigImplAbi,
		client,
	});
	return split.read.pendingAmount();
}

/**
 * Get total unclaimed amounts across all recipients.
 */
export async function getTotalUnclaimed(
	client: PublicClient,
	splitAddress: Address,
): Promise<bigint> {
	const split = getContract({
		address: splitAddress,
		abi: splitConfigImplAbi,
		client,
	});
	return split.read.totalUnclaimed();
}

/**
 * Preview what will happen when executeSplit is called.
 */
export async function previewExecution(
	client: PublicClient,
	splitAddress: Address,
): Promise<EvmExecutionPreview> {
	const split = getContract({
		address: splitAddress,
		abi: splitConfigImplAbi,
		client,
	});

	const [
		recipientAmounts,
		protocolFee,
		available,
		pendingRecipientAmounts,
		pendingProtocolAmount,
	] = await split.read.previewExecution();

	return {
		recipientAmounts: recipientAmounts as bigint[],
		protocolFee,
		available,
		pendingRecipientAmounts: pendingRecipientAmounts as bigint[],
		pendingProtocolAmount,
	};
}

/**
 * Get full split configuration from a split address.
 */
export async function getSplitConfig(
	client: PublicClient,
	splitAddress: Address,
): Promise<EvmSplitConfig | null> {
	try {
		const split = getContract({
			address: splitAddress,
			abi: splitConfigImplAbi,
			client,
		});

		// Check if it's actually a split
		const isValid = await split.read.isCascadeSplitConfig();
		if (!isValid) {
			return null;
		}

		const [factory, authority, token, uniqueId, recipients] = await Promise.all(
			[
				split.read.factory(),
				split.read.authority(),
				split.read.token(),
				split.read.uniqueId(),
				split.read.getRecipients(),
			],
		);

		return {
			address: splitAddress,
			factory,
			authority,
			token,
			uniqueId,
			recipients: recipients as EvmRecipient[],
		};
	} catch {
		return null;
	}
}

/**
 * Get the default token (USDC) address for a chain.
 */
export function getDefaultToken(chainId: number): Address {
	return getUsdcAddress(chainId);
}
