import type { Chain } from "../types.js";
import { localIdOfSlug } from "../webtic-direct.js";
import { cinemaIdOfSlug } from "./the-space.js";
import type { Circuit } from "./types.js";

export function chainOfSlug(theatreSlug: string): Chain {
  if (cinemaIdOfSlug(theatreSlug) !== null) return "space";
  return localIdOfSlug(theatreSlug) === null ? "uci" : "webtic";
}

export function createCircuits(list: Circuit[]) {
  const byChain = new Map(list.map((circuit) => [circuit.chain, circuit]));
  function forChain(chain: Chain): Circuit {
    const circuit = byChain.get(chain);
    if (!circuit) throw new Error(`no circuit for ${chain}`);
    return circuit;
  }
  return {
    forChain,
    forSlug: (theatreSlug: string) => forChain(chainOfSlug(theatreSlug)),
  };
}

export type Circuits = ReturnType<typeof createCircuits>;
