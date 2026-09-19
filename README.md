# Decatron Translate — extensión de Chrome

Escucha un stream de Twitch en tu idioma. El streamer enciende la traducción desde
[Decatron Desktop](https://github.com/decatrondev/decatron-desktop); tú eliges el idioma en el
player y **solo tú** oyes el doblaje y ves los subtítulos. El chat, el canal y el resto de la
audiencia no cambian.

## Qué hace en el player

- Botón 🌐 junto al engranaje, solo en canales que ofrecen traducción. Punto verde: el streamer
  está traduciendo ahora; punto morado: estás escuchando.
- Menú con los idiomas del canal (y cuántos lo escuchan), volumen de la voz original de fondo,
  retraso para cuadrar con el video y subtítulos.
- Mientras suena la traducción, el volumen del video baja al nivel de fondo; cuando el streamer
  calla, vuelve solo (así el juego se oye).
- Subtítulos con revelado palabra a palabra al ritmo del audio; opcionalmente también la frase
  original.
- Recuerda tu idioma por canal y, si quieres, se une sola a tu idioma preferido.

## Cómo funciona

```
twitch.tv/<canal> ── content script ──► GET decatron.net/api/live-translation/public/<canal>
                                     ──► wss://decatron.net/hubs/translation  (SignalR, JSON)
                                            Join(canal, idioma) → Status / SegmentStart / SegmentChunk / SegmentEnd
```

- Sin cuenta ni login. Solo pide permiso sobre `twitch.tv` y `decatron.net`.
- El hub se habla con un cliente SignalR mínimo propio (`signalr-lite.js`) para no cargar la
  librería oficial en cada pestaña.
- El audio llega en trozos MP3, se decodifica con Web Audio y se encola en orden; el volumen
  del `<video>` se controla directamente (ducking inverso con rampa).
- Preferencias en `chrome.storage.sync`; idioma por canal en `chrome.storage.local`.

## Instalar en modo desarrollador

1. `chrome://extensions` → activar «Modo de desarrollador».
2. «Cargar descomprimida» → carpeta `src/`.
3. Abrir un canal que tenga la traducción activada.

## Probar sin Twitch

`test/e2e.mjs` carga la extensión en Chromium contra una réplica del DOM del player
(`test/fake-twitch.html`), servida como `https://www.twitch.tv/anthonydeca`, y contra el backend
real. Con un simulador de la app mandando audio al canal, verifica botón, menú, subtítulos y el
ducking del volumen.

```bash
npm i
npm run test:video          # video falso con audio (ffmpeg)
DURATION=60 npm run test:e2e
```

## Publicar

`npm run pack` genera `decatron-translate.zip` con el contenido de `src/` para subir a la Chrome
Web Store. Firefox después con el mismo código (MV3 compatible).

## Backend

Vive en el repo del bot (`decatrondev/decatron`): `LiveTranslationController` (estado público),
`TranslationHub` y `LiveTranslationSessionManager`. Plan completo en el panel de admin del
dashboard (`dev-docs/plans/REALTIME_TRANSLATION_PLAN.md`).
