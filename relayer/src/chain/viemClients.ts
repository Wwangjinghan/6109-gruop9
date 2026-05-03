import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, mainnet, foundry, zksync, zksyncSepoliaTestnet } from "viem/chains";
import { ENTRY_POINT_ABI, ENTRY_POINT_ADDRESS } from "../abi/entryPoint.js";

// ─── Chain selection ──────────────────────────────────────────────────────────

// ZK Stack local devnet (chain ID 271, RPC http://127.0.0.1:3050)
const zksyncLocal: Chain = {
  ...zksync,
  id: 271,
  name: "ZK Stack Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:3050"] }, public: { http: ["http://127.0.0.1:3050"] } },
};

const CHAIN_MAP: Record<string, Chain> = {
  sepolia,
  mainnet,
  foundry,
  anvil: foundry,
  localhost: foundry,
  zksync: zksyncLocal,
  zksync_local: zksyncLocal,
  era: zksyncLocal,
  zksync_sepolia: zksyncSepoliaTestnet,
};

export function resolveChain(name: string): Chain {
  const chain = CHAIN_MAP[name.toLowerCase()];
  if (!chain) throw new Error(`Unsupported chain: ${name}. Use 'sepolia', 'mainnet', 'foundry', or 'zksync'.`);
  return chain;
}

// ─── Client factory ───────────────────────────────────────────────────────────

export interface ChainClients {
  publicClient: PublicClient;
  walletClient: WalletClient;
  agentAddress: Address;
}

export function createChainClients(
  rpcUrl: string,
  privateKey: Hex,
  chainName: string,
): ChainClients {
  const chain = resolveChain(chainName);
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  return { publicClient, walletClient, agentAddress: account.address };
}

// ─── EntryPoint helpers ───────────────────────────────────────────────────────

export async function getEntryPointNonce(
  publicClient: PublicClient,
  accountAddress: Address,
  entryPointAddress: Address = ENTRY_POINT_ADDRESS,
): Promise<bigint> {
  return publicClient.readContract({
    address: entryPointAddress,
    abi: ENTRY_POINT_ABI,
    functionName: "getNonce",
    args: [accountAddress, 0n],
  }) as Promise<bigint>;
}

export async function getUserOpHash(
  publicClient: PublicClient,
  userOp: {
    sender: Address;
    nonce: bigint;
    initCode: Hex;
    callData: Hex;
    accountGasLimits: Hex;
    preVerificationGas: bigint;
    gasFees: Hex;
    paymasterAndData: Hex;
    signature: Hex;
  },
  entryPointAddress: Address = ENTRY_POINT_ADDRESS,
): Promise<Hex> {
  return publicClient.readContract({
    address: entryPointAddress,
    abi: ENTRY_POINT_ABI,
    functionName: "getUserOpHash",
    args: [userOp],
  }) as Promise<Hex>;
}

// ─── Gas fee helpers ──────────────────────────────────────────────────────────

export async function fetchGasFees(
  publicClient: PublicClient,
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const baseFee = block.baseFeePerGas ?? 1_000_000_000n;
  const maxPriorityFeePerGas = 1_500_000_000n; // 1.5 gwei tip
  const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

// ─── PackedUserOperation gas limit packing ────────────────────────────────────
// accountGasLimits = uint128(verificationGasLimit) << 128 | uint128(callGasLimit)
// gasFees          = uint128(maxPriorityFeePerGas) << 128 | uint128(maxFeePerGas)

export function packGasLimits(verificationGasLimit: bigint, callGasLimit: bigint): Hex {
  const packed = (verificationGasLimit << 128n) | callGasLimit;
  return `0x${packed.toString(16).padStart(64, "0")}` as Hex;
}

export function packGasFees(maxPriorityFeePerGas: bigint, maxFeePerGas: bigint): Hex {
  const packed = (maxPriorityFeePerGas << 128n) | maxFeePerGas;
  return `0x${packed.toString(16).padStart(64, "0")}` as Hex;
}
