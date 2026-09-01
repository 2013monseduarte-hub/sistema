# viral — buscador de memes y comentarios virales

Encuentra lo que está explotando **ahora**, te dice **por qué** funcionó, y te da
ángulos para hacer tu propia versión sin que sea un calco.

```bash
bun run viral trending --pack memes-es --window day -n 20
bun run viral trending --pack memes --html /tmp/tablero.html   # tablero con imágenes
bun run viral mina --pack comentarios-es -n 8                  # posts + sus mejores comentarios
bun run viral buscar "gimnasio" --pack memes-es --window week
bun run viral remix 3 --nicho "gimnasio" --prompt
bun run viral cambios                                          # qué sigue subiendo desde la última vez
bun run viral original original.txt borrador.txt               # ¿es un calco?
```

Instalado como binario del stack: `bin/gstack-viral <comando>` (mismo argumento,
sin `bun run`).

## Qué hace distinto

**Puntúa por velocidad, no por votos totales.** Un post de hace 40 minutos con
4.000 votos vale más que uno de 90.000 de hace tres días: el segundo ya pasó, el
primero todavía lo puedes montar. El score 0-100 pesa:

| Componente | Peso (posts) | Peso (comentarios) | Qué mide |
|---|---|---|---|
| Velocidad (votos/hora, escala log) | 0.60 | 0.55 | si sigue subiendo ahora mismo |
| Densidad de comentarios | 0.25 | 0.15 | si la gente discute, no solo pasa |
| Ratio de votos positivos | 0.15 | — | si el público está de acuerdo |
| Reutilizabilidad del texto | — | 0.30 | si la frase se puede levantar tal cual |

La reutilizabilidad premia el texto de 40 a 280 caracteres (largo de titular o de
pie de foto), castiga los enlaces, y pone a cero los `[deleted]` y los bots.

**Busca también en los comentarios.** El oro de un hilo casi nunca es el post: es
la respuesta con 9.000 votos que cabe en una imagen. `mina` trae los dos en una
pasada, y solo abre hilos de texto con al menos 20 respuestas: en un meme de
imagen los comentarios son gifs de reacción, y cada petición gastada ahí es una
que no gastas donde hay material.

**Dice qué sigue subiendo, no solo qué está arriba.** `cambios` compara tus dos
últimas búsquedas. Ojo al detalle, que es donde casi todo el mundo se equivoca:
un post que aguanta toda la tarde en portada tiene una velocidad media que BAJA
(los mismos votos repartidos entre más horas) aunque siga corriendo. Por eso la
tendencia se mide con el ritmo ENTRE las dos búsquedas (votos ganados ÷ horas
transcurridas) comparado con la media que ese item traía antes.

**Junta los crossposts.** El mismo meme en seis subreddits son seis filas de tu
top 15. Se funden en una, marcada `×6`, y se queda la copia con mejor score (la
que más rápido sube ahora mismo, que no siempre es la que más votos acumula). Ese
número también es señal: un chiste que ha llegado a cinco comunidades viaja.
Con `--no-dedupe` los ves todos.

**Avisa cuando tu versión es la original con otra tipografía.** `original` compara
tu borrador con la fuente (trigramas, coeficiente de Dice) y a partir del 60% te
dice que las plataformas van a leer eso como duplicado.

## Comandos

| Comando | Para qué |
|---|---|
| `trending` | lo más viral ahora en un pack de comunidades |
| `buscar <texto>` | búsqueda por palabra clave |
| `comentarios <url\|id>` | los mejores comentarios de un post concreto |
| `mina` | posts virales + sus mejores comentarios |
| `cambios` | qué acelera desde tu búsqueda anterior |
| `remix <n\|--texto "...">` | seis ángulos para adaptarlo a tu cuenta |
| `original <a> <b>` | compara borrador contra fuente (sale 3 si es un calco) |
| `packs` | lista los packs de comunidades |
| `ultimo` | reimprime la última búsqueda, sin red |

`gstack-viral --help` tiene la lista completa de opciones.

## Sin terminal: que lo ejecute GitHub

`.github/workflows/virales.yml` hace la búsqueda en los servidores de GitHub y
deja el resultado en un issue del repo: tabla completa, las cinco de arriba con
imagen, y el bloque de "qué sigue subiendo". Se lanza con el botón **Run
workflow** de la pestaña Actions, o solo a las 09:00 y 17:00 UTC.

Para que aparezca el botón y funcione el horario, el workflow tiene que estar en
la rama por defecto del repo: GitHub solo ejecuta `schedule` y `workflow_dispatch`
desde ahí. Mientras viva en una rama de trabajo, no se ejecuta.

Detalles que importan:

- Corre en `ubuntu-latest`, no en los runners de pago del repo original.
- Las búsquedas anteriores viajan en la caché de Actions, que es lo que permite
  que `cambios` tenga con qué comparar. Dos pasadas al día es lo que hace útil
  ese bloque; con una sola no hay comparación.
- Siempre `--sfw`, porque el issue puede ser público.
- Solo queda abierto el issue más reciente; los anteriores se cierran (no se
  borran) para que la lista no se llene.
- El tablero HTML con todas las imágenes queda como artifact de la ejecución,
  14 días.
- Permisos del token: leer el código y escribir issues. Nada más.

## En la web: desplegar en Netlify

En Netlify sí funciona una versión web de verdad, porque la búsqueda corre en una
función del servidor y no en el navegador (el navegador tiene bloqueadas las
llamadas a otros dominios; el servidor no).

```
netlify.toml              configuración: publish, funciones, redirect /api/buscar
netlify/functions/buscar.mts   la búsqueda como función de servidor
web/index.html            la página con el formulario
```

Para desplegarlo: en Netlify, **Add new site → Import an existing project**,
eliges este repo y la rama. La configuración ya está en `netlify.toml`, no hay
que tocar nada en el panel. Al terminar tienes una URL pública con el formulario,
y `TU-SITIO.netlify.app/api/buscar?pack=memes-es` devuelve el tablero directo.

Con `?formato=json` devuelve los datos en crudo, por si quieres montar otra cosa
encima.

Lo que manda en el diseño de la función es el reloj: una función de Netlify tiene
unos 10 segundos, y un pack de seis comunidades a la pausa de 700 ms de la CLI se
come casi todo. Por eso ahí la pausa baja a 350 ms, se topan las comunidades en
seis, se reintenta una sola vez y la respuesta se cachea cinco minutos: recargar
el navegador no dispara otra ronda de peticiones.

Dos diferencias con la CLI, a propósito: siempre se filtra el +18 (la URL es
pública) y no hay `cambios`, porque el disco de una función es efímero y no
guarda las búsquedas anteriores. Para el histórico están la CLI y el workflow de
GitHub Actions.

## Packs

Los packs son atajos: `--pack memes-es` en vez de escribir seis comunidades. Los
que vienen de fábrica (`memes-es`, `memes`, `historias-es`, `historias`,
`comentarios`, `comentarios-es`, `virales`) son **puntos de partida**, no verdad
revelada: las comunidades se cierran, se renombran y se vuelven privadas. Cuando
una no responde sale un aviso con el motivo, nunca desaparece en silencio.

Los tuyos van en `~/.gstack/viral/packs.json` y pisan a los de fábrica:

```json
{
  "mi-nicho": { "lang": "es", "about": "lo mío", "communities": ["gimnasio", "fitness_es"] }
}
```

## Desde un servidor: credenciales obligatorias

En tu máquina no hace falta nada. Desde un servidor, sí.

Reddit responde **403 al tráfico anónimo que sale de IPs de proveedores de nube**.
Comprobado en un runner de GitHub con cuatro combinaciones (User-Agent propio, de
navegador, ninguno, y contra `old.reddit.com`): las cuatro rechazadas en menos de
0,1 s. No es el agente, es la IP, y no hay arreglo por código en la vía anónima.
Un cliente registrado en la API oficial sí tiene entrada.

Cómo registrarse, una vez y para siempre:

1. Entra en <https://www.reddit.com/prefs/apps> y pulsa **create another app**.
2. Tipo **script**. Nombre, el que quieras. En *redirect uri* pon
   `http://localhost:8080` (no se usa, pero el formulario lo pide).
3. Al crearla salen dos cadenas: el **id** (debajo del nombre, corto) y el
   **secret**.

Y dónde ponerlas:

| Dónde | Cómo |
|---|---|
| Tu máquina | `export REDDIT_CLIENT_ID=... REDDIT_CLIENT_SECRET=...` |
| GitHub Actions | Settings → Secrets and variables → Actions → New repository secret |
| Netlify | Site configuration → Environment variables |

Con `REDDIT_CLIENT_ID` y `REDDIT_CLIENT_SECRET` basta. Si además pones
`REDDIT_USERNAME` y `REDDIT_PASSWORD` (los de tu cuenta), se usa el grant
`password`, que es el camino más fiable para una app de tipo script.

Sin credenciales no se rompe nada: se sigue por la vía anónima de siempre, que
funciona desde casa y falla desde un servidor.

## De dónde salen los datos

Listados públicos `.json` de Reddit: las mismas páginas que abres en el navegador,
sin API key y sin login. Una petición cada 700 ms (también entre las lecturas de
comentarios: la pausa vive en el adaptador, no en quien lo llama), `limit` tope
100. Es un lector de investigación, no un crawler.

Con credenciales las lecturas van a `oauth.reddit.com` con un token que se pide
una vez por ejecución y se reutiliza hasta que caduca.

Si el servidor responde `429` o un `5xx`, se reintenta dos veces respetando la
cabecera `Retry-After`, y si pide más de un minuto se abandona en vez de dejar la
terminal colgada. Un `404` o un `403` no se reintentan: la respuesta no va a
cambiar y repetir solo empeora tu reputación con el servidor.

Cada petición deja un recibo de egress en `~/.gstack/security/egress.jsonl`
(destino y clase de payload, nunca el contenido). Míralos con `bin/gstack-egress list`.

Añadir otra fuente (TikTok, IG, X) es escribir un adaptador en
`viral/src/sources/` que devuelva `ViralItem[]`. El scorer, el render y el remix
no se enteran.

## Sobre copiar

El formato se copia; el contenido concreto, no. Un meme reencuadrado con tu
contexto es contenido nuevo; el mismo JPG con tu marca de agua es una repostada,
y tanto las plataformas como tu audiencia lo notan. Por eso cada resultado
guarda su URL de origen (esa es la atribución), `remix` empuja hacia cambios
profundos (historia real, inversión, pregunta) y no superficiales, y `original`
te frena antes de publicar. Si la imagen es de otra persona, cítala o rehazla.

## Estructura

```
viral/src/
  cli.ts              comandos y flags
  score.ts            velocidad, engagement, reutilizabilidad → score 0-100
  dedupe.ts           funde crossposts (clave de imagen + parecido de título)
  diff.ts             ritmo entre dos búsquedas → acelera / nuevo / enfría
  remix.ts            ángulos, brief para modelo, control de originalidad
  render.ts           tabla de terminal, JSON, Markdown, tablero HTML, vista de cambios
  packs.ts            packs de comunidades (+ overrides del usuario)
  store.ts            ~/.gstack/viral/runs/ (0600, se podan a 50)
  receipted-fetch.ts  recibo de egress + reintentos ante 429/5xx
  sources/reddit.ts   adaptador: URLs, parseo puro, errores por comunidad
  sources/reddit-auth.ts  token de la API oficial (necesario desde un servidor)
```

Tests: `test/viral-*.test.ts` (gratis, sin red — el fetch va inyectado).
