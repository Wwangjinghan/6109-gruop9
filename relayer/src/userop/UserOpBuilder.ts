import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { INTENT_ACCOUNT_ABI } from "../abi/intentAccount.js";
import { ENTRY_POINT_ABI, ENTRY_POINT_ADDRESS } from "../abi/entryPoint.js";
import {
  getEntryPointNonce,
  fetchGasFees,
  packGasLimits,
  packGasFees,
} from "../chain/viemClients.js";
import type { CombinedBatch } from "../types/intent.js";
import { logger } from "../utils/logger.js";

// ─── PackedUserOperation (mirrors Solidity struct) ───────────────────────────

export interface PackedUserOperation {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;  // packed: uint128(verificationGasLimit) | uint128(callGasLimit)
  preVerificationGas: bigint;
  gasFees: Hex;           // packed: uint128(maxPriorityFeePerGas) | uint128(maxFeePerGas)
  paymasterAndData: Hex;
  signature: Hex;         // filled in by the submitter after hashing
}

export interface GasEstimate {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

// ─── Default gas constants (fallback when estimation RPC is unavailable) ──────
const DEFAULT_VERIFICATION_GAS = 200_000n;
const DEFAULT_CALL_GAS_BASE    = 100_000n;
const CALL_GAS_PER_CALL        =  80_000n;
const DEFAULT_PRE_VERIFICATION =  50_000n;
// 20 % buffer applied on top of on-chain estimates
const GAS_BUFFER_PCT = 120n;

// ─── Builder ──────────────────────────────────────────────────────────────────

export class UserOpBuilder {
  private readonly publicClient: PublicClient;
  private readonly entryPointAddress: Address;

  constructor(publicClient: PublicClient, entryPointAddress: Address = ENTRY_POINT_ADDRESS) {
    this.publicClient = publicClient;
    this.entryPointAddress = entryPointAddress;
  }

  /**
   * Build an unsigned PackedUserOperation from a CombinedBatch.
   *
   * The batch may contain:
   *   - Multiple combinedSwaps, each representing a group of SWAP intents
   *     encoded as calls[]. All swap calls are flattened into a single executeBatch.
   *   - singleCalls for DCA/REBALANCE intents.
   *
   * All calls are merged into one executeBatch call on the IntentAccount so
   * a single UserOperation covers the entire batch.
   */
  async build(batch: CombinedBatch): Promise<PackedUserOperation> {
    const allCalls = this._flattenCalls(batch);
    const callData = this._encodeCallData(allCalls);
    const nonce = await getEntryPointNonce(this.publicClient, batch.account, this.entryPointAddress);

    // Build a draft op with constant gas so we can pass it to eth_estimateUserOperationGas
    const { maxFeePerGas, maxPriorityFeePerGas } = await fetchGasFees(this.publicClient);
    const draftOp: PackedUserOperation = {
      sender: batch.account,
      nonce,
      initCode: "0x",
      callData,
      accountGasLimits: packGasLimits(DEFAULT_VERIFICATION_GAS, DEFAULT_CALL_GAS_BASE),
      preVerificationGas: DEFAULT_PRE_VERIFICATION,
      gasFees: packGasFees(maxPriorityFeePerGas, maxFeePerGas),
      paymasterAndData: "0x",
      signature: "0x",
    };

    const gas = await this._estimateGas(allCalls.length, draftOp);

    return {
      ...draftOp,
      accountGasLimits: packGasLimits(gas.verificationGasLimit, gas.callGasLimit),
      preVerificationGas: gas.preVerificationGas,
      gasFees: packGasFees(gas.maxPriorityFeePerGas, gas.maxFeePerGas),
    };
  }

  /**
   * Fetch the userOpHash from the EntryPoint for a given (unsigned) UserOp.
   * The relayer signs this hash with the agent key.
   */
  async getUserOpHash(userOp: PackedUserOperation): Promise<Hex> {
    return this.publicClient.readContract({
      address: this.entryPointAddress,
      abi: ENTRY_POINT_ABI,
      functionName: "getUserOpHash",
      args: [userOp],
    }) as Promise<Hex>;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _flattenCalls(
    batch: CombinedBatch,
  ): Array<{ target: Address; value: bigint; data: Hex }> {
    const calls: Array<{ target: Address; value: bigint; data: Hex }> = [];

    for (const group of batch.combinedSwaps) {
      calls.push(...group.calls);
    }

    for (const solo of batch.singleCalls) {
      calls.push({ target: solo.target, value: solo.value, data: solo.data });
    }

    return calls;
  }

  private _encodeCallData(
    calls: Array<{ target: Address; value: bigint; data: Hex }>,
  ): Hex {
    if (calls.length === 0) {
      // No-op — encode a no-call so the UserOp is still valid
      return "0x" as Hex;
    }

    if (calls.length === 1) {
      return encodeFunctionData({
        abi: INTENT_ACCOUNT_ABI,
        functionName: "execute",
        args: [calls[0].target, calls[0].value, calls[0].data],
      });
    }

    return encodeFunctionData({
      abi: INTENT_ACCOUNT_ABI,
      functionName: "executeBatch",
      args: [calls],
    });
  }

  private async _estimateGas(callCount: number, draftOp?: PackedUserOperation): Promise<GasEstimate> {
    const { maxFeePerGas, maxPriorityFeePerGas } = await fetchGasFees(this.publicClient);

    if (draftOp) {
      try {
        const est = await (this.publicClient as PublicClient & {
          request: (args: { method: string; params: unknown[] }) => Promise<{
            preVerificationGas: Hex;
            verificationGasLimit: Hex;
            callGasLimit: Hex;
          }>;
        }).request({
          method: "eth_estimateUserOperationGas",
          params: [
            {
              sender: draftOp.sender,
              nonce: `0x${draftOp.nonce.toString(16)}`,
              initCode: draftOp.initCode,
              callData: draftOp.callData,
              // use zeros so the estimation doesn't depend on real gas limits
              accountGasLimits: "0x" + "0".repeat(64),
              preVerificationGas: "0x0",
              gasFees: draftOp.gasFees,
              paymasterAndData: draftOp.paymasterAndData,
              signature: draftOp.signature !== "0x"
                ? draftOp.signature
                // dummy 65-byte sig so validation doesn't revert
                : ("0x" + "1b".padStart(2, "0") + "00".repeat(64)) as Hex,
            },
            this.entryPointAddress,
          ],
        });

        const buf = (n: bigint) => (n * GAS_BUFFER_PCT) / 100n;
        const preVerificationGas = buf(BigInt(est.preVerificationGas));
        const verificationGasLimit = buf(BigInt(est.verificationGasLimit));
        const callGasLimit = buf(BigInt(est.callGasLimit));

        logger.debug(
          { preVerificationGas: preVerificationGas.toString(), verificationGasLimit: verificationGasLimit.toString(), callGasLimit: callGasLimit.toString() },
          "Gas estimated via eth_estimateUserOperationGas",
        );

        return { verificationGasLimit, callGasLimit, preVerificationGas, maxFeePerGas, maxPriorityFeePerGas };
      } catch (err) {
        logger.warn({ err }, "eth_estimateUserOperationGas failed — using constant fallback");
      }
    }

    // Constant fallback
    const callGasLimit = DEFAULT_CALL_GAS_BASE + CALL_GAS_PER_CALL * BigInt(Math.max(callCount - 1, 0));
    return {
      verificationGasLimit: DEFAULT_VERIFICATION_GAS,
      callGasLimit,
      preVerificationGas: DEFAULT_PRE_VERIFICATION,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
  }
}
