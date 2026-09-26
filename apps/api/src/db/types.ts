import type { Db } from "./client.js";

/** Either the root db handle or a transaction — services accept both so they compose inside transactions. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
