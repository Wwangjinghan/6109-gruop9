export const INTENT_REGISTRY_ABI = [
  {
    name: "recordBatchExecution",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "intentIds", type: "bytes32[]" }],
    outputs: [],
  },
  {
    name: "offChainIntentExecutedAt",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "BatchRecorded",
    type: "event",
    inputs: [
      { name: "intentIds", type: "bytes32[]", indexed: false },
      { name: "executedAt", type: "uint256", indexed: false },
    ],
  },
] as const;
