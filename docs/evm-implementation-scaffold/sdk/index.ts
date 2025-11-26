/**
 * Cascade Splits SDK for EVM (Base)
 *
 * Revenue sharing in 5 minutes.
 *
 * Naming aligned with Solana implementation for cross-chain parity.
 *
 * @example
 * ```typescript
 * import { CascadeSplits } from "@cascade-fyi/splits-sdk/evm";
 *
 * const sdk = new CascadeSplits({ rpcUrl: "https://mainnet.base.org" });
 *
 * // Create a split config
 * const { splitConfig, tx } = await sdk.buildCreateSplitConfig(authority, {
 *   token: USDC_BASE,
 *   recipients: [
 *     { addr: "0x...", percentageBps: 900 },   // 9%
 *     { addr: "0x...", percentageBps: 9000 },  // 90%
 *   ],
 * });
 *
 * // Sign and send
 * await wallet.sendTransaction(tx);
 *
 * // Use `splitConfig` as your x402 payTo address
 * ```
 */

import {
  createPublicClient,
  http,
  type PublicClient,
  type Address,
  encodeFunctionData,
  parseAbi,
  getContract,
  type Hex,
} from "viem";
import { base, baseSepolia } from "viem/chains";

// ============ Types (Solana-aligned) ============

/**
 * Recipient configuration
 * Matches Solana's Recipient struct exactly
 */
export interface Recipient {
  addr: Address; // Solana: address (Pubkey)
  percentageBps: number; // Solana: percentage_bps (1-9900)
}

/**
 * Split configuration
 * Matches Solana's SplitConfig account structure
 */
export interface SplitConfigInfo {
  splitConfig: Address;
  authority: Address;
  token: Address; // EVM naming (Solana: mint)
  uniqueId: Hex;
  recipients: Recipient[];
}

/**
 * Execution preview
 */
export interface ExecutionPreview {
  recipientAmounts: bigint[];
  protocolAmount: bigint;
  available: bigint;
}

/**
 * Parameters for creating a split config
 */
export interface CreateSplitConfigParams {
  token: Address; // EVM naming (Solana: mint)
  recipients: Recipient[];
  uniqueId?: Hex;
}

/**
 * Result from building a create split config transaction
 */
export interface CreateSplitConfigResult {
  splitConfig: Address;
  uniqueId: Hex;
  transaction: {
    to: Address;
    data: Hex;
  };
}

// ============ Constants (Solana-aligned) ============

export const SPLIT_FACTORY_BASE = "0x..." as Address; // TODO: Deploy and fill
export const SPLIT_FACTORY_BASE_SEPOLIA = "0x..." as Address;

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
export const USDC_BASE_SEPOLIA =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

export const PROTOCOL_FEE_BPS = 100; // 1%
export const REQUIRED_SPLIT_TOTAL = 9900; // 99%
export const MIN_RECIPIENTS = 1;
export const MAX_RECIPIENTS = 20;

// ============ ABIs (Solana-aligned function names) ============

const FACTORY_ABI = parseAbi([
  // Solana: create_split_config
  "function createSplitConfig(address configAuthority, address token, bytes32 uniqueId, (address addr, uint16 percentageBps)[] recipients) returns (address splitConfig)",
  "function computeSplitAddress(address configAuthority, address token, bytes32 uniqueId) view returns (address)",
  "function splitExists(address configAuthority, address token, bytes32 uniqueId) view returns (bool)",
  "function getSplit(address configAuthority, address token, bytes32 uniqueId) view returns (address)",
  // Solana: update_protocol_config
  "function updateProtocolConfig(address newFeeWallet) external",
  // Solana: transfer_protocol_authority
  "function transferProtocolAuthority(address newAuthority) external",
  // Solana: accept_protocol_authority
  "function acceptProtocolAuthority() external",
  "function feeWallet() view returns (address)",
  "function authority() view returns (address)",
  "function pendingAuthority() view returns (address)",
  // Events
  "event SplitConfigCreated(address indexed splitConfig, address indexed configAuthority, address indexed token, bytes32 uniqueId, (address addr, uint16 percentageBps)[] recipients)",
]);

const SPLIT_CONFIG_ABI = parseAbi([
  // Solana: execute_split
  "function executeSplit() external",
  // Solana: update_split_config
  "function updateSplitConfig((address addr, uint16 percentageBps)[] recipients) external",
  "function transferAuthority(address newAuthority) external",
  "function getRecipients() view returns ((address addr, uint16 percentageBps)[])",
  "function getRecipientCount() view returns (uint256)",
  "function previewExecution() view returns (uint256[] recipientAmounts, uint256 protocolAmount, uint256 available)",
  "function hasPendingFunds() view returns (bool)",
  "function pendingAmount() view returns (uint256)",
  "function isCascadeSplitConfig() view returns (bool)",
  "function authority() view returns (address)",
  "function token() view returns (address)",
  "function uniqueId() view returns (bytes32)",
  "function unclaimedAmounts(address) view returns (uint256)",
  "function protocolUnclaimed() view returns (uint256)",
  "function getBalance() view returns (uint256)",
  // Events
  "event SplitExecuted(address indexed splitConfig, uint256 totalAmount, uint256 recipientsDistributed, uint256 protocolFee, uint256 heldAsUnclaimed, uint256 unclaimedCleared, uint256 protocolUnclaimedCleared, address executor)",
  "event SplitConfigUpdated(address indexed splitConfig, (address addr, uint16 percentageBps)[] recipients)",
  "event AuthorityTransferred(address indexed splitConfig, address indexed oldAuthority, address indexed newAuthority)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

// ============ SDK ============

export interface CascadeSplitsConfig {
  rpcUrl: string;
  factoryAddress?: Address;
  chain?: "base" | "base-sepolia";
}

export class CascadeSplits {
  private client: PublicClient;
  private factoryAddress: Address;
  private chain: typeof base | typeof baseSepolia;

  constructor(config: CascadeSplitsConfig) {
    this.chain = config.chain === "base-sepolia" ? baseSepolia : base;
    this.client = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    });

    this.factoryAddress =
      config.factoryAddress ??
      (config.chain === "base-sepolia"
        ? SPLIT_FACTORY_BASE_SEPOLIA
        : SPLIT_FACTORY_BASE);
  }

  // ============ Build Transactions (Solana-aligned naming) ============

  /**
   * Build a transaction to create a new split config
   *
   * Solana equivalent: create_split_config
   *
   * @param authority - Address that will control the split
   * @param params - Split configuration
   * @returns splitConfig address (deterministic) and unsigned transaction
   */
  async buildCreateSplitConfig(
    authority: Address,
    params: CreateSplitConfigParams
  ): Promise<CreateSplitConfigResult> {
    const uniqueId = params.uniqueId ?? this.generateUniqueId();

    // Validate
    this.validateRecipients(params.recipients);

    // Compute deterministic split address
    const splitConfig = await this.computeSplitAddress(
      authority,
      params.token,
      uniqueId
    );

    // Build transaction data
    const data = encodeFunctionData({
      abi: FACTORY_ABI,
      functionName: "createSplitConfig",
      args: [authority, params.token, uniqueId, params.recipients],
    });

    return {
      splitConfig,
      uniqueId,
      transaction: {
        to: this.factoryAddress,
        data,
      },
    };
  }

  /**
   * Build a transaction to execute a split (distribute funds)
   *
   * Solana equivalent: execute_split
   */
  async buildExecuteSplit(
    splitConfig: Address
  ): Promise<{ transaction: { to: Address; data: Hex } }> {
    const data = encodeFunctionData({
      abi: SPLIT_CONFIG_ABI,
      functionName: "executeSplit",
      args: [],
    });

    return {
      transaction: {
        to: splitConfig,
        data,
      },
    };
  }

  /**
   * Build a transaction to update split config (split must be empty)
   *
   * Solana equivalent: update_split_config
   */
  async buildUpdateSplitConfig(
    splitConfig: Address,
    recipients: Recipient[]
  ): Promise<{ transaction: { to: Address; data: Hex } }> {
    this.validateRecipients(recipients);

    const data = encodeFunctionData({
      abi: SPLIT_CONFIG_ABI,
      functionName: "updateSplitConfig",
      args: [recipients],
    });

    return {
      transaction: {
        to: splitConfig,
        data,
      },
    };
  }

  /**
   * Build a transaction to transfer authority
   */
  async buildTransferAuthority(
    splitConfig: Address,
    newAuthority: Address
  ): Promise<{ transaction: { to: Address; data: Hex } }> {
    const data = encodeFunctionData({
      abi: SPLIT_CONFIG_ABI,
      functionName: "transferAuthority",
      args: [newAuthority],
    });

    return {
      transaction: {
        to: splitConfig,
        data,
      },
    };
  }

  // ============ Read Methods ============

  /**
   * Get split configuration
   */
  async getSplitConfig(splitConfig: Address): Promise<SplitConfigInfo | null> {
    try {
      const contract = getContract({
        address: splitConfig,
        abi: SPLIT_CONFIG_ABI,
        client: this.client,
      });

      const [authority, token, uniqueId, recipients] = await Promise.all([
        contract.read.authority(),
        contract.read.token(),
        contract.read.uniqueId(),
        contract.read.getRecipients(),
      ]);

      return {
        splitConfig,
        authority,
        token,
        uniqueId,
        recipients: recipients.map(
          (r: { addr: Address; percentageBps: number }) => ({
            addr: r.addr,
            percentageBps: r.percentageBps,
          })
        ),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get current split balance
   */
  async getBalance(splitConfig: Address): Promise<bigint> {
    return this.client.readContract({
      address: splitConfig,
      abi: SPLIT_CONFIG_ABI,
      functionName: "getBalance",
    });
  }

  /**
   * Check if split has pending funds
   */
  async hasPendingFunds(splitConfig: Address): Promise<boolean> {
    return this.client.readContract({
      address: splitConfig,
      abi: SPLIT_CONFIG_ABI,
      functionName: "hasPendingFunds",
    });
  }

  /**
   * Get pending amount for next execution
   */
  async getPendingAmount(splitConfig: Address): Promise<bigint> {
    return this.client.readContract({
      address: splitConfig,
      abi: SPLIT_CONFIG_ABI,
      functionName: "pendingAmount",
    });
  }

  /**
   * Preview what an execution would distribute
   */
  async previewExecution(splitConfig: Address): Promise<ExecutionPreview> {
    const result = (await this.client.readContract({
      address: splitConfig,
      abi: SPLIT_CONFIG_ABI,
      functionName: "previewExecution",
    })) as [bigint[], bigint, bigint];

    return {
      recipientAmounts: result[0],
      protocolAmount: result[1],
      available: result[2],
    };
  }

  /**
   * Compute split address before deployment
   */
  async computeSplitAddress(
    authority: Address,
    token: Address,
    uniqueId: Hex
  ): Promise<Address> {
    return this.client.readContract({
      address: this.factoryAddress,
      abi: FACTORY_ABI,
      functionName: "computeSplitAddress",
      args: [authority, token, uniqueId],
    });
  }

  /**
   * Check if split exists
   */
  async splitExists(
    authority: Address,
    token: Address,
    uniqueId: Hex
  ): Promise<boolean> {
    return this.client.readContract({
      address: this.factoryAddress,
      abi: FACTORY_ABI,
      functionName: "splitExists",
      args: [authority, token, uniqueId],
    });
  }

  /**
   * Detect if an address is a Cascade Split
   */
  async detectSplitConfig(address: Address): Promise<boolean> {
    try {
      const result = await this.client.readContract({
        address,
        abi: SPLIT_CONFIG_ABI,
        functionName: "isCascadeSplitConfig",
      });
      return result === true;
    } catch {
      return false;
    }
  }

  // ============ Utilities ============

  /**
   * Generate a random unique ID
   */
  generateUniqueId(): Hex {
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    return `0x${Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}` as Hex;
  }

  /**
   * Validate recipients configuration
   * Matches Solana validation exactly
   */
  private validateRecipients(recipients: Recipient[]): void {
    if (
      recipients.length < MIN_RECIPIENTS ||
      recipients.length > MAX_RECIPIENTS
    ) {
      throw new Error(
        `Recipients count must be ${MIN_RECIPIENTS}-${MAX_RECIPIENTS}`
      );
    }

    const totalBps = recipients.reduce((sum, r) => sum + r.percentageBps, 0);
    if (totalBps !== REQUIRED_SPLIT_TOTAL) {
      throw new Error(
        `Recipients must sum to ${REQUIRED_SPLIT_TOTAL} bps (99%), got ${totalBps}`
      );
    }

    const addresses = new Set<string>();
    for (const r of recipients) {
      if (r.addr === "0x0000000000000000000000000000000000000000") {
        throw new Error("Zero address not allowed");
      }
      if (r.percentageBps === 0) {
        throw new Error("Zero percentage not allowed");
      }
      if (addresses.has(r.addr.toLowerCase())) {
        throw new Error("Duplicate recipient");
      }
      addresses.add(r.addr.toLowerCase());
    }
  }
}

// ============ x402 Integration Helpers ============

/**
 * Helper for x402 facilitators and keepers
 */
export class X402SplitHelper {
  private sdk: CascadeSplits;

  constructor(sdk: CascadeSplits) {
    this.sdk = sdk;
  }

  /**
   * Process a payTo address for x402
   * Returns split info if it's a split config, null otherwise
   */
  async processPayTo(payTo: Address): Promise<{
    isSplit: boolean;
    config?: SplitConfigInfo;
    preview?: ExecutionPreview;
  }> {
    const isSplit = await this.sdk.detectSplitConfig(payTo);

    if (!isSplit) {
      return { isSplit: false };
    }

    const config = await this.sdk.getSplitConfig(payTo);
    const preview = await this.sdk.previewExecution(payTo);

    return {
      isSplit: true,
      config: config ?? undefined,
      preview,
    };
  }

  /**
   * Get all splits with pending funds from a list
   * Useful for keeper services
   */
  async getSplitsWithPendingFunds(
    splits: Address[]
  ): Promise<
    {
      splitConfig: Address;
      pendingAmount: bigint;
    }[]
  > {
    const results: { splitConfig: Address; pendingAmount: bigint }[] = [];

    for (const splitConfig of splits) {
      try {
        const hasPending = await this.sdk.hasPendingFunds(splitConfig);
        if (hasPending) {
          const amount = await this.sdk.getPendingAmount(splitConfig);
          results.push({ splitConfig, pendingAmount: amount });
        }
      } catch {
        // Skip invalid splits
      }
    }

    return results;
  }

  /**
   * Build batch execute transactions
   * Returns individual transactions (use multicall for atomicity)
   */
  async buildBatchExecuteSplit(
    splits: Address[]
  ): Promise<{
    transactions: { to: Address; data: Hex }[];
  }> {
    const transactions = await Promise.all(
      splits.map(async (splitConfig) => {
        const { transaction } = await this.sdk.buildExecuteSplit(splitConfig);
        return transaction;
      })
    );

    return { transactions };
  }
}

// ============ Exports ============

export default CascadeSplits;
