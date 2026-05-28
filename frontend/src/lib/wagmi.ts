import { http, createConfig } from "wagmi";
import { sepolia, mainnet, foundry } from "wagmi/chains";
import { injected, metaMask } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [foundry, sepolia, mainnet],
  connectors: [injected(), metaMask()],
  transports: {
    [foundry.id]: http("http://127.0.0.1:8545"),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL),
    [mainnet.id]: http(process.env.NEXT_PUBLIC_MAINNET_RPC_URL),
  },
});
