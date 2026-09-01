/**
 * viral reddit-auth — la vía autenticada.
 *
 * Existe porque Reddit devuelve 403 al tráfico anónimo que sale de IPs de
 * nube: comprobado en un runner de GitHub con cuatro combinaciones de agente y
 * host, todas rechazadas. Estos tests fijan que con credenciales la petición
 * cambia de host y lleva Bearer, que sin ellas no cambia nada, y que el token
 * se pide una vez y se reutiliza.
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  authFromEnv, getAccessToken, hasCredentials, OAUTH_HOST, resetTokenCacheForTests,
  toOAuthUrl, TOKEN_MARGIN_MS, TOKEN_URL,
} from '../viral/src/sources/reddit-auth';
import { fetchCommunities, listingUrl } from '../viral/src/sources/reddit';

const ROOT = path.resolve(import.meta.dir, '..');
const listing = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/viral-reddit-listing.json'), 'utf-8'));

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-auth-'));
const prevHome = process.env.GSTACK_HOME;
process.env.GSTACK_HOME = home;

afterAll(() => {
  if (prevHome === undefined) delete process.env.GSTACK_HOME;
  else process.env.GSTACK_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(() => resetTokenCacheForTests());

const CREDS = { clientId: 'id123', clientSecret: 'secreto' };

/** Recoge cada petición para poder afirmar sobre host, cabeceras y cuerpo. */
function spy(responses: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: any, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const body = u.startsWith(TOKEN_URL) ? responses.token : responses.data;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => body,
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

const TOKEN_OK = { access_token: 'tok-abc', expires_in: 3600, token_type: 'bearer' };

describe('authFromEnv', () => {
  test('lee las cuatro variables', () => {
    const auth = authFromEnv({
      REDDIT_CLIENT_ID: 'a', REDDIT_CLIENT_SECRET: 'b',
      REDDIT_USERNAME: 'c', REDDIT_PASSWORD: 'd',
    } as NodeJS.ProcessEnv);
    expect(auth).toEqual({ clientId: 'a', clientSecret: 'b', username: 'c', password: 'd' });
  });

  test('sin id y secreto no hay credenciales: se va por la vía anónima', () => {
    expect(hasCredentials(authFromEnv({} as NodeJS.ProcessEnv))).toBe(false);
    expect(hasCredentials({ clientId: 'solo-id' })).toBe(false);
    expect(hasCredentials(CREDS)).toBe(true);
    expect(hasCredentials(undefined)).toBe(false);
  });
});

describe('toOAuthUrl', () => {
  test('cambia el host y respeta ruta y parámetros', () => {
    const original = listingUrl('SpanishMeme', { window: 'week', limit: 30 });
    const oauth = toOAuthUrl(original);
    expect(new URL(oauth).host).toBe(OAUTH_HOST);
    expect(new URL(oauth).pathname).toBe(new URL(original).pathname);
    expect(new URL(oauth).search).toBe(new URL(original).search);
  });
});

describe('getAccessToken', () => {
  test('pide client_credentials cuando solo hay id y secreto', async () => {
    const { fetchImpl, calls } = spy({ token: TOKEN_OK });
    expect(await getAccessToken({ ...CREDS, fetchImpl })).toBe('tok-abc');
    expect(calls[0].url).toBe(TOKEN_URL);
    expect(calls[0].init?.method).toBe('POST');
    expect(String(calls[0].init?.body)).toContain('grant_type=client_credentials');
  });

  test('usa el grant password cuando además hay usuario y contraseña', async () => {
    const { fetchImpl, calls } = spy({ token: TOKEN_OK });
    await getAccessToken({ ...CREDS, username: 'yo', password: 'clave', fetchImpl });
    expect(String(calls[0].init?.body)).toContain('grant_type=password');
    expect(String(calls[0].init?.body)).toContain('username=yo');
  });

  test('autentica el intercambio con Basic, no con el secreto en la URL', async () => {
    const { fetchImpl, calls } = spy({ token: TOKEN_OK });
    await getAccessToken({ ...CREDS, fetchImpl });
    const auth = (calls[0].init?.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Basic ${Buffer.from('id123:secreto').toString('base64')}`);
    expect(calls[0].url).not.toContain('secreto');
  });

  test('el token se reutiliza: una sola petición para varias llamadas', async () => {
    const { fetchImpl, calls } = spy({ token: TOKEN_OK });
    await getAccessToken({ ...CREDS, fetchImpl });
    await getAccessToken({ ...CREDS, fetchImpl });
    await getAccessToken({ ...CREDS, fetchImpl });
    expect(calls).toHaveLength(1);
  });

  test('se renueva antes de caducar, no cuando ya caducó a mitad de búsqueda', async () => {
    const { fetchImpl, calls } = spy({ token: TOKEN_OK });
    const t0 = 1_000_000;
    await getAccessToken({ ...CREDS, fetchImpl }, t0);
    // justo dentro del margen de seguridad: hay que pedir otro
    await getAccessToken({ ...CREDS, fetchImpl }, t0 + 3600_000 - TOKEN_MARGIN_MS + 1);
    expect(calls).toHaveLength(2);
  });

  test('un 401 explica qué revisar en vez de soltar un número', async () => {
    const fetchImpl = (async () => ({
      ok: false, status: 401, headers: { get: () => null }, json: async () => ({}),
    })) as unknown as typeof globalThis.fetch;
    await expect(getAccessToken({ ...CREDS, fetchImpl })).rejects.toThrow(/HTTP 401/);
    await expect(getAccessToken({ ...CREDS, fetchImpl })).rejects.toThrow(/script/);
  });

  test('una respuesta sin token es un error, no un token vacío', async () => {
    const { fetchImpl } = spy({ token: { expires_in: 3600 } });
    await expect(getAccessToken({ ...CREDS, fetchImpl })).rejects.toThrow(/sin token/);
  });

  test('sin credenciales ni se intenta', async () => {
    await expect(getAccessToken({})).rejects.toThrow(/REDDIT_CLIENT_ID/);
  });
});

describe('el adaptador con credenciales', () => {
  test('va al host autenticado y manda Bearer en cada lectura', async () => {
    const { fetchImpl, calls } = spy({ token: TOKEN_OK, data: listing });
    const result = await fetchCommunities(['SpanishMeme', 'memexico'], {
      auth: { ...CREDS }, fetchImpl, delayMs: 0,
    });
    // 1 token + 2 comunidades
    expect(calls).toHaveLength(3);
    const lecturas = calls.slice(1);
    for (const call of lecturas) {
      expect(new URL(call.url).host).toBe(OAUTH_HOST);
      expect((call.init?.headers as Record<string, string>).Authorization).toBe('bearer tok-abc');
    }
    expect(result.items.length).toBe(8);
  });

  test('sin credenciales no cambia nada: mismo host y sin Bearer', async () => {
    const { fetchImpl, calls } = spy({ data: listing });
    await fetchCommunities(['SpanishMeme'], { auth: {}, fetchImpl, delayMs: 0 });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).host).toBe('www.reddit.com');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  test('el recibo del token no guarda hash del cuerpo: ahí van credenciales', async () => {
    const { fetchImpl } = spy({ token: TOKEN_OK, data: listing });
    await fetchCommunities(['SpanishMeme'], { auth: { ...CREDS }, fetchImpl, delayMs: 0 });
    const ledger = path.join(home, 'security', 'egress.jsonl');
    const lines = fs.readFileSync(ledger, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    const tokenReceipt = lines.filter((l) => l.payload_class === 'reddit-token').pop();
    expect(tokenReceipt).toBeDefined();
    expect(tokenReceipt.sha256).toBeNull();
    expect(tokenReceipt.host).toBe('www.reddit.com');
    // y desde luego nunca el secreto en claro
    expect(JSON.stringify(lines)).not.toContain('secreto');
  });
});
