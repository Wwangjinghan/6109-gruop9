import { type Hex, type WalletClient, keccak256, encodePacked, encodeAbiParameters, parseAbiParameters } from "viem";

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://localhost:3001";

export interface IntentParams {
  target: Hex;
  callData: Hex;
  value?: bigint;
  deadlineOffsetSecs?: number;
}

export interface SubmittedIntent {
  intentId: string;
  status: string;
}

export async function buildAndSubmitIntent(
  walletClient: WalletClient,
  params: IntentParams,
  nonce: number
): Promise<SubmittedIntent> {
  const sender = walletClient.account!.address;
  const deadline = Math.floor(Date.now() / 1000) + (params.deadlineOffsetSecs ?? 3600);
  const value = params.value ?? 0n;

  const intentId = keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, address, bytes, uint256, uint256, uint256"),
      [sender, params.target, params.callData, value, BigInt(deadline), BigInt(nonce)]
    )
  );

  const ethSignedHash = keccak256(
    encodePacked(["string", "bytes32"], ["\x19Ethereum Signed Message:\n32", intentId])
  );

  const signature = await walletClient.signMessage({ account: walletClient.account!, message: { raw: ethSignedHash } });

  const res = await fetch(`${RELAYER_URL}/intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender,
      target: params.target,
      callData: params.callData,
      value: value.toString(),
      deadline,
      nonce,
      signature,
    }),
  });

  if (!res.ok) throw new Error(`Relayer error: ${res.statusText}`);
  return res.json();
}
