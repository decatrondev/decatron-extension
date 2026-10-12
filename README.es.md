# Decatron — extensión de navegador para Twitch

[English](README.md)

Una extensión con **módulos**: cada función de Decatron en Twitch es un módulo que se enciende y apaga solo, todos dentro de
un mismo panel. Funciona en Chrome, Edge, Brave y Opera; hay un paquete para Firefox (ver más abajo).
Página pública: <https://decatron.net/translate>.

| Módulo | Estado | Qué hace |
|---|---|---|
| **Traducción** | ✅ | Escucha el stream en tu idioma con el doblaje de la [traducción en vivo de Decatron](https://decatron.net/docs/translation). Solo tú lo oyes. |
| **Emotes** | ✅ | Dibuja en el chat los emotes de **7TV, BetterTTV, FrankerFaceZ** y los **propios de Decatron** (los que sube la comunidad de cada canal), sin instalar otras extensiones. Incluye el selector con `:`. |
| **Multi-view** | ✅ | Suma el canal que estás viendo a tu [Multi-view](https://decatron.net/docs/multiview) (varios canales de Twitch y Kick en una sola pantalla). Si ya tienes uno abierto, el canal se agrega ahí sin recargarlo, así que los videos no se cortan. |
| **Puntos de canal** | ✅ | Reclama solo el **bonus** de puntos (el cofre) unos segundos después de que aparece, con un retardo aleatorio de 1 a 5 s y un aviso «+50 puntos». **Apagado por defecto**, interruptor por canal, solo el bonus: no canjea recompensas ni apuesta puntos. Avisa si detecta FrankerFaceZ o BetterTTV (también pueden reclamar; el bonus se reclama una sola vez). |

## Cómo se usa

- Un botón de Decatron en la barra del player abre el **panel** (un modal dentro de Twitch) con una pestaña por módulo y
  un interruptor para encender o apagar cada uno.
- El icono de la barra del navegador abre un popup corto: el estado del canal, los interruptores de los módulos y un
  atajo al panel.
- Todo se guarda en `chrome.storage.sync`; el idioma de la traducción por canal, en `chrome.storage.local`.

### Emotes

- Al abrir un canal se arma su diccionario: los emotes propios de Decatron (`decatron.net/api/public/emotes/<canal>`) y los de 7TV, BTTV y
  FFZ (globales y del canal) **directo desde el navegador a cada servicio**. Prioridad ante un mismo nombre: propios de Decatron >
  7TV > BTTV > FFZ, y lo del canal sobre lo global (la misma que usa el overlay de chat de Decatron). El set global de Decatron tiene
  la prioridad más baja.
- Las palabras del chat que coinciden con un emote pasan a ser imágenes; los emotes nativos de Twitch no se tocan. Los emotes
  «encima del anterior» (zero-width: sombreros, efectos) se apilan sobre el emote de antes.
- Convive con FrankerFaceZ, BTTV y 7TV: dibuja lo que esas extensiones dejan como texto (por ejemplo los emotes de 7TV si solo tienes FFZ, o los propios de Decatron), sin duplicar los que ellas ya reemplazaron. FFZ rehace las líneas del chat con otro HTML (`span.message`); también se soporta. Si prefieres, en el panel se puede elegir dibujar solo los propios.
- **Selector con `:`**: escribe `:` y las primeras letras en la caja de chat; flechas, Enter o Tab (o un clic) para elegir.
  La caja de Twitch es un editor Slate: el texto se inserta con un evento `beforeinput`, con respaldo por pegado.
- Los demás ven estos emotes en el chat solo si también tienen una extensión que los dibuje; en el overlay del stream se ven siempre.

## Estructura

```
src/
  manifest.json
  background.js        service worker: fetch al backend (CORS), diccionarios de emotes, badge
  emote-dict.js        diccionario de emotes (propios + 7TV + BTTV + FFZ), compartido con las pruebas de Node
  i18n.js              textos en español e inglés (según el idioma del navegador)
  core.js              preferencias, registro de módulos, eventos y utilidades (window.__decatron)
  kit.js               piezas de formulario de los paneles
  shell.js + panel.css botón del player y panel (Shadow DOM)
  modules/             translation.js · emotes.js · multiview.js · points.js
  multiview-page.js    corre en decatron.net/multi: pasa «agrega este canal» de la extensión a la página
  login-page.js        corre SOLO en decatron.net/extension/login: recibe el token de espectador de la página y lo guarda
  emote-picker.js      selector con ":"
  captions-ui.js       subtítulos y aviso de audio sobre el video (traducción)
  audio.js, dsp.js, signalr-lite.js
  main.js              arranque, módulos y navegación SPA de Twitch
  popup.*              popup de la barra del navegador
```

**Cómo agregar un módulo:** un archivo en `src/modules/` que llame a `window.__decatron.register({ id, order, icon, defaults, name,
description, start, stop, onChannel(login), status, renderPanel(body) })`, y listarlo en `content_scripts` del manifest. El panel, el
popup, el interruptor y el guardado de ajustes salen solos.

## Permisos

Solo `storage`, y acceso a: `twitch.tv` (la página), `decatron.net` (traducción, emotes propios, la página del Multi-view —solo recibe «agrega este canal»— y la página `/extension/login`, que entrega el token de espectador: solo te identifica ante la traducción en vivo y no da acceso al panel), `7tv.io`, `api.betterttv.net`
y `api.frankerfacez.com` (sus emotes) y `gql.twitch.tv` (el id del canal, que 7TV y BTTV piden por id). Sin cuenta ni login.

## Instalar en modo desarrollador

1. `chrome://extensions` → activar «Modo de desarrollador».
2. «Cargar descomprimida» → carpeta `src/`.

Las fichas de las tiendas (Chrome Web Store, Firefox Add-ons y Opera Add-ons) están preparadas en `store/`; la página
`/translate` activa el botón de cada tienda cuando esa tienda publica la extensión.

## Paquetes

```
npm run pack           # decatron-chrome-<versión>.zip
npm run pack:firefox   # decatron-firefox-<versión>.zip (manifest con background.scripts e id de Firefox)
```

El paquete de Firefox pasa `web-ext lint` sin errores, pero **no se ha probado dentro de Firefox**.

## Pruebas

```
npm i
npm run test:dict      # diccionario de emotes contra 7TV, BTTV, FFZ y Twitch reales (necesita red)
npm run test:twitch -- <canal-en-vivo>   # botón, panel, carga de emotes y reemplazo contra el Twitch REAL (chat público)
npm run test:picker    # selector con ":" contra un editor Slate de verdad
npm run test:ffz -- <canal-en-vivo>      # junto a FrankerFaceZ (carga su script en el Twitch real)
npm run test:login     # inicio de sesión: la página de login entrega el token de espectador, se guarda, viaja al hub, tokens vencidos o no reconocidos, otra página de decatron.net no puede guardar uno y cerrar sesión (hub simulado local)
npm run test:denied    # traducción: la extensión explica cuando el canal rechaza la entrada (tope de oyentes, pausa, idioma que no se ofrece), con un hub simulado local
npm run test:points    # módulo de puntos de canal contra una réplica del cofre del bonus: apagado por defecto, retardo, aviso, botón destructivo, canal bloqueado y detección de FFZ (no necesita red ni cuenta de Twitch)
npm run test:multiview # módulo Multi-view: abre uno, suma un segundo canal sin recargarlo y comprueba el aviso de duplicado (decatron.net real)
npm run test:video && npm run test:e2e   # traducción contra una réplica del player (con DURATION=3 solo mira la interfaz)
npm run test:dsp       # estiramiento de voz (WSOLA), tiempos de subtítulos y validación de los valores del servidor; sin red
npm run test:catchup   # modo alcance, historial, repetir y solo subtítulos en Chromium real con un hub simulado (necesita ffmpeg)
```

`test:twitch` inyecta líneas con la forma del chat de Twitch en el contenedor real para comprobar el reemplazo; no puede escribir en la
caja de chat porque sin sesión Twitch no la deja usar (por eso el selector se prueba aparte, contra Slate).
Hace falta un Chromium (`CHROME=/ruta/al/chrome` o el de Playwright).

## Cómo funciona la traducción

```
twitch.tv/<canal> ── content script ──► GET decatron.net/api/live-translation/public/<canal>
                                     ──► wss://decatron.net/hubs/translation  (SignalR, JSON)
                                            Join(canal, idioma) → Status / SegmentStart / SegmentChunk / SegmentEnd
```

El audio llega en trozos MP3, se decodifica con Web Audio y se encola en orden; el volumen del `<video>` se controla directamente
(ducking inverso con rampa). Los subtítulos revelan las palabras al ritmo del audio.

### Modo alcance, historial y solo subtítulos (0.3.0)

- **Modo alcance** (`audio.js`, `dsp.js`): según los segundos de audio que quedan por delante, la voz se acelera por escalones sin
  subirle el tono (WSOLA, no `playbackRate`). Solo si la cola pasa del límite se omiten las frases más viejas: se avisa sobre el video
  y quedan marcadas en el historial. El servidor también omite lo que ya esperó demasiado (`SegmentDropped`, motivo `stale`).
- **Subtítulos**: cada palabra se enciende según cuándo suena la voz (`dsp.wordTimings`). Con «solo subtítulos» no suena nada y el texto
  sale al llegar, a ritmo de lectura.
- **Historial** (`modules/translation.js`): las últimas frases con botón para repetir las que aún tienen audio guardado (las 6 últimas).
- **Valores ajustables desde el servidor**: la consulta pública del canal trae `tuning` (umbrales y velocidades del modo alcance, límite
  de cola, tiempos). Se editan en `LiveTranslation:ClientTuning` de `appsettings.json` del bot y se recargan solos, **sin publicar
  versión en las tiendas**. Son solo datos: `dsp.sanitizeTuning` los valida y los recorta a límites fijos (velocidad máx. 1.5x), y si algo
  no cuadra usa el valor de fábrica. Nada que venga del servidor se ejecuta.

## Backend y manual

El servidor vive en el repo del bot ([`decatrondev/decatron`](https://github.com/decatrondev/decatron)):
`TranslationHub`, `LiveTranslationController`, `PublicEmotesController` y el catálogo de emotes. Guías de uso:
<https://decatron.net/docs/translation> (página de la extensión para espectadores) y <https://decatron.net/docs/chat>
(emotes).
