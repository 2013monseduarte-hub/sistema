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

## De dónde salen los datos

Listados públicos `.json` de Reddit: las mismas páginas que abres en el navegador,
sin API key y sin login. Una petición cada 700 ms (también entre las lecturas de
comentarios: la pausa vive en el adaptador, no en quien lo llama), `limit` tope
100. Es un lector de investigación, no un crawler.

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
```

Tests: `test/viral-*.test.ts` (gratis, sin red — el fetch va inyectado).
