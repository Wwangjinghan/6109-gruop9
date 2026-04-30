// ERC-4337 EntryPoint v0.7 — subset of ABI needed by the relayer
export const ENTRY_POINT_ABI = [
  {
    name: "handleOps",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "ops",
        type: "tuple[]",
        components: [
          { name: "sender",              type: "address" },
          { name: "nonce",               type: "uint256" },
          { name: "initCode",            type: "bytes"   },
          { name: "callData",            type: "bytes"   },
          { name: "accountGasLimits",    type: "bytes32" },
          { name: "preVerificationGas",  type: "uint256" },
          { name: "gasFees",             type: "bytes32" },
          { name: "paymasterAndData",    type: "bytes"   },
          { name: "signature",           type: "bytes"   },
        ],
      },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "getNonce",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key",    type: "uint192" },
    ],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
  {
    name: "getUserOpHash",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "userOp",
        type: "tuple",
        components: [
          { name: "sender",              type: "address" },
          { name: "nonce",               type: "uint256" },
          { name: "initCode",            type: "bytes"   },
          { name: "callData",            type: "bytes"   },
          { name: "accountGasLimits",    type: "bytes32" },
          { name: "preVerificationGas",  type: "uint256" },
          { name: "gasFees",             type: "bytes32" },
          { name: "paymasterAndData",    type: "bytes"   },
          { name: "signature",           type: "bytes"   },
        ],
      },
    ],
    outputs: [{ name: "hash", type: "bytes32" }],
  },
  {
    name: "depositTo",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
  },
  {
    name: "UserOperationEvent",
    type: "event",
    inputs: [
      { name: "userOpHash",    type: "bytes32",  indexed: true  },
      { name: "sender",        type: "address",  indexed: true  },
      { name: "paymaster",     type: "address",  indexed: true  },
      { name: "nonce",         type: "uint256",  indexed: false },
      { name: "success",       type: "bool",     indexed: false },
      { name: "actualGasCost", type: "uint256",  indexed: false },
      { name: "actualGasUsed", type: "uint256",  indexed: false },
    ],
  },
  {
    name: "FailedOp",
    type: "error",
    inputs: [
      { name: "opIndex", type: "uint256" },
      { name: "reason",  type: "string"  },
    ],
  },
] as const;

// Canonical v0.7 EntryPoint address — same on all EVM chains
export const ENTRY_POINT_ADDRESS =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;
