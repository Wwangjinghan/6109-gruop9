// IntentAccount — subset of ABI needed to encode executeBatch callData
export const INTENT_ACCOUNT_ABI = [
  {
    name: "execute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value",  type: "uint256" },
      { name: "data",   type: "bytes"   },
    ],
    outputs: [],
  },
  {
    name: "executeBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value",  type: "uint256" },
          { name: "data",   type: "bytes"   },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "getNonce",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
] as const;
