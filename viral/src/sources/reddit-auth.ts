/**
 * reddit-auth — acceso autenticado a la API oficial de Reddit.
 *
 * POR QUÉ EXISTE: Reddit responde 403 al tráfico ANÓNIMO que sale de rangos de
 * IP de proveedores de nube. Comprobado en un runner de GitHub: los mismos 403
 * con User-Agent propio, con uno de navegador, sin ninguno, y también contra
 * old.reddit.com. No es el agente, es la IP, y no hay arreglo por código en la
 * vía anónima. Un cliente registrado sí tiene entrada.
 *
 * Desde una IP residencial (tu portátil) nada de esto hace falta: sin
 * credenciales el adaptador sigue yendo por la vía anónima de siempre.
 *
 * Dos formas de autenticar, según lo que haya en el entorno:
 *   - client_credentials  con REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET
 *   - password            si además hay REDDIT_USERNAME + REDDIT_PASSWORD
 *     (apps de tipo "script"; es el camino más fiable de los dos)
 *
 * El token se pide una vez por proceso y se reutiliza hasta que caduca.
 */

import { receiptedFetch, type FetchLike } from '../receipted-fetch';

export const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
export const OAUTH_HOST = 'oauth.reddit.com';
/** margen antes de la caducidad: renovamos antes de que el token muera a mitad de una búsqueda */
export const TOKEN_MARGIN_MS = 60_000;

export interface AuthConfig {
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  userAgent?: string;
  fetchImpl?: FetchLike;
}

export function authFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  return {
    clientId: env.REDDIT_CLIENT_ID,
    clientSecret: env.REDDIT_CLIENT_SECRET,
    username: env.REDDIT_USERNAME,
    password: env.REDDIT_PASSWORD,
  };
}

/** Sin id y secreto no hay nada que intentar: se va por la vía anónima. */
export function hasCredentials(auth: AuthConfig | undefined): boolean {
  return Boolean(auth?.clientId && auth?.clientSecret);
}

/** El endpoint autenticado vive en otro host; la ruta y los parámetros son los mismos. */
export function toOAuthUrl(url: string): string {
  const parsed = new URL(url);
  parsed.host = OAUTH_HOST;
  return parsed.toString();
}

interface CachedToken {
  token: string;
  expiresAt: number;
  key: string;
}

let cache: CachedToken | undefined;

/** Los tests parten de cero: si no, el token de un test se cuela en el siguiente. */
export function resetTokenCacheForTests(): void {
  cache = undefined;
}

function cacheKey(auth: AuthConfig): string {
  // El secreto NO entra en la clave: no hace falta para distinguir clientes y
  // así no acaba en memoria más veces de las necesarias.
  return `${auth.clientId}:${auth.username ?? ''}`;
}

/**
 * Devuelve un token válido, pidiéndolo solo si hace falta.
 *
 * El cuerpo lleva credenciales cuando se usa el grant `password`, así que el
 * recibo de egress se escribe SIN hash del cuerpo: registramos que hubo un
 * envío y a dónde, nunca un hash de una contraseña.
 */
export async function getAccessToken(auth: AuthConfig, now: number = Date.now()): Promise<string> {
  if (!hasCredentials(auth)) throw new Error('faltan REDDIT_CLIENT_ID y REDDIT_CLIENT_SECRET');
  const key = cacheKey(auth);
  if (cache && cache.key === key && cache.expiresAt > now + TOKEN_MARGIN_MS) return cache.token;

  const form = new URLSearchParams(
    auth.username && auth.password
      ? { grant_type: 'password', username: auth.username, password: auth.password }
      : { grant_type: 'client_credentials' },
  );
  const basic = Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString('base64');

  const res = await receiptedFetch(
    'reddit-token',
    TOKEN_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': auth.userAgent ?? 'gstack-viral/0.1',
      },
      body: form.toString(),
    },
    auth.fetchImpl ?? globalThis.fetch,
    { hashBody: false },
  );

  if (!res.ok) {
    // 401 = id o secreto mal. 400 = el grant no encaja con el tipo de app.
    throw new Error(
      `no pude autenticar con Reddit (HTTP ${res.status}). ` +
        `Revisa REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET, y que la app sea de tipo "script".`,
    );
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Reddit contestó sin token de acceso');

  cache = {
    token: data.access_token,
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
    key,
  };
  return cache.token;
}
