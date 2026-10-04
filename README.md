# Decatron — extensión de navegador para Twitch

Una extensión con **módulos**: cada función de Decatron en Twitch es un módulo que se enciende y apaga solo, todos dentro de
un mismo panel. Funciona en Chrome, Edge, Brave y Opera; hay un paquete para Firefox (ver más abajo).

| Módulo | Estado | Qué hace |
|---|---|---|
| **Traducción** | ✅ | Escucha el stream en tu idioma con el doblaje de [Decatron Translate](https://decatron.net/translate). Solo tú lo oyes. |
| **Emotes** | ✅ | Dibuja en el chat los emotes de **7TV, BetterTTV, FrankerFaceZ** y los **propios de Decatron** (los que sube la comunidad de cada canal), sin instalar otras extensiones. Incluye el selector con `:`. |
| **Puntos de canal** | 🔜 | Cobrar solo el bonus de puntos del canal y más automatismos. |

## Cómo se usa

- Un botón de Decatron en la barra del player abre el **panel** (un modal dentro de Twitch) con una pestaña por módulo y
  un interruptor para encender o apagar cada uno.
- El icono de la barra del navegador abre un popup corto: el estado del canal, los interruptores de los módulos y un
  atajo al panel.
- Todo se guarda en `chrome.storage.sync`; el idioma de la traducción por canal, en `chrome.storage.local`.

### Emotes

- Al abrir un canal se arma su diccionario: los emotes propios de Decatron (`decatron.net/api/public/emotes/<canal>`) y los de 7TV, BTTV y
  FFZ (globales y del canal) **directo desde el navegador a cada servicio**. Prioridad ante un mismo nombre: propios de Decatron >
  7TV > BTTV > FFZ, y lo del canal sobre lo global (la misma que usa el overlay de chat de Decatron).
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
  modules/             translation.js · emotes.js · points.js
  emote-picker.js      selector con ":"
  captions-ui.js       subtítulos y aviso de audio sobre el video (traducción)
  audio.js, signalr-lite.js
  main.js              arranque, módulos y navegación SPA de Twitch
  popup.*              popup de la barra del navegador
```

**Cómo agregar un módulo:** un archivo en `src/modules/` que llame a `window.__decatron.register({ id, order, icon, defaults, name,
description, start, stop, onChannel(login), status, renderPanel(body) })`, y listarlo en `content_scripts` del manifest. El panel, el
popup, el interruptor y el guardado de ajustes salen solos.

## Permisos

Solo `storage`, y acceso a: `twitch.tv` (la página), `decatron.net` (traducción y emotes propios), `7tv.io`, `api.betterttv.net`
y `api.frankerfacez.com` (sus emotes) y `gql.twitch.tv` (el id del canal, que 7TV y BTTV piden por id). Sin cuenta ni login.

## Instalar en modo desarrollador

1. `chrome://extensions` → activar «Modo de desarrollador».
2. «Cargar descomprimida» → carpeta `src/`.

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
npm run test:ffz -- <canal-en-vivo>   # junto a FrankerFaceZ (carga su script en el Twitch real)
npm run test:video && npm run test:e2e   # traducción contra una réplica del player (con DURATION=3 solo mira la interfaz)
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
