import { http, createConfig } from "wagmi";
import { monadTestnet } from "wagmi/chains";
import { metaMask, injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [injected(), metaMask()],
  transports: {
    [monadTestnet.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
