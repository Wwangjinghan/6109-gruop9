export const AGENT_REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "capabilities", type: "string[]" }],
    outputs: [],
  },
  {
    name: "isRegistered",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "AgentRegistered",
    type: "event",
    inputs: [
      { name: "agent",        type: "address",  indexed: true  },
      { name: "capabilities", type: "string[]", indexed: false },
    ],
  },
] as const;
