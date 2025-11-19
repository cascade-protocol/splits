/**
 * Instruction discriminators for Cascade Splits
 * Derived from Anchor IDL (first 8 bytes of sha256("global:instruction_name"))
 */

export const DISCRIMINATORS = {
	initializeProtocol: new Uint8Array([188, 233, 252, 106, 134, 146, 202, 91]),
	updateProtocolConfig: new Uint8Array([197, 97, 123, 54, 221, 168, 11, 135]),
	transferProtocolAuthority: new Uint8Array([
		35, 76, 36, 77, 136, 112, 158, 222,
	]),
	createSplitConfig: new Uint8Array([128, 42, 60, 106, 4, 233, 18, 190]),
	executeSplit: new Uint8Array([6, 45, 171, 40, 49, 129, 23, 89]),
	updateSplitConfig: new Uint8Array([47, 103, 74, 170, 55, 251, 130, 146]),
	closeSplitConfig: new Uint8Array([170, 202, 252, 92, 196, 160, 247, 229]),
} as const;

/**
 * Account discriminators (for parsing account data)
 */
export const ACCOUNT_DISCRIMINATORS = {
	protocolConfig: new Uint8Array([207, 91, 250, 28, 152, 179, 215, 209]),
	splitConfig: new Uint8Array([49, 201, 50, 228, 22, 142, 12, 222]),
} as const;
