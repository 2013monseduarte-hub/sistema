/**
 * receipted-fetch — egress-receipted wrapper for the viral finder's public-API
 * reads (sink 'viral-scrape').
 *
 * Writes a content-free receipt BEFORE the send: the destination host, a
 * payload class, byte count and sha256 of any request body — never the body
 * itself, never a URL query. FAIL-OPEN: a receipt hiccup warns on stderr and
 * the read proceeds. Browsing public listings must not die because an audit
 * log could not be written; the ledger records ATTEMPTED egress for auditing,
 * it is not a send gate here.
 *
 * Inspect what went out with `bin/gstack-egress list`.
 */

import { sha256Hex, writeReceipt } from '../../lib/egress-receipt';

export type FetchLike = typeof globalThis.fetch;

export interface ReceiptOptions {
  /**
   * Poner a false cuando el cuerpo lleva credenciales (el intercambio de token
   * de Reddit). El recibo registra igual el destino y el tamaño; lo que no
   * guarda es un hash de una contraseña.
   */
  hashBody?: boolean;
}

export async function receiptedFetch(
  payloadClass: string,
  url: string,
  init?: RequestInit,
  fetchImpl: FetchLike = globalThis.fetch,
  options: ReceiptOptions = {},
): Promise<Response> {
  try {
    const body = init?.body;
    let bytes = 0;
    let sha256: string | null = null;
    if (typeof body === 'string') {
      bytes = Buffer.byteLength(body);
      if (options.hashBody !== false) sha256 = sha256Hex(body);
    }
    writeReceipt({
      sink: 'viral-scrape',
      host: new URL(url).host,
      payloadClass,
      bytes,
      sha256,
      consent: 'user ran a gstack-viral command',
    });
  } catch (err) {
    process.stderr.write(
      `[viral] no pude escribir el recibo de egress (${(err as Error).message}) — sigo igual (fail-open). ` +
        `gstack registra lo que INTENTA enviar fuera de la máquina; míralo con gstack-egress.\n`,
    );
  }
  return fetchImpl(url, init);
}
