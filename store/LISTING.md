# Ficha de la tienda (versión antigua: Decatron Translate)

> Los textos vigentes (Decatron 0.2.x) están en `CHROME_LISTING.txt` y `FIREFOX_LISTING.txt`. Este archivo queda como referencia histórica.

Copiar/pegar al crear el elemento en https://chrome.google.com/webstore/devconsole

## Paquete
`npm run pack` → sube `decatron-chrome-<versión>.zip` (contenido de `src/`). Para Firefox (addons.mozilla.org): `npm run pack:firefox`.

> **Versión 0.2.0 (borrador de ficha nueva).** La extensión pasa a llamarse **Decatron** y a tener módulos (traducción y emotes). Al subirla, actualizar nombre, resumen, descripciones y la pestaña de privacidad con los textos de «0.2.0» de más abajo; los de «Decatron Translate» quedan como referencia de la ficha actual.

## Datos básicos
- **Nombre:** Decatron Translate
- **Resumen (≤132):** Escucha tu stream favorito de Twitch en tu idioma. Solo tú lo oyes: el canal y el chat no cambian.
- **Categoría:** Entretenimiento (o Accesibilidad)
- **Idioma:** Español (añadir Inglés con los textos de abajo)

## Descripción (ES)
Decatron Translate añade un botón 🌐 al player de Twitch en los canales que ofrecen traducción en vivo. Eliges tu idioma y escuchas al streamer doblado en tiempo real, con subtítulos, mientras su voz original queda de fondo. Nadie más lo nota: el canal, el chat y el resto del público siguen igual.

Cómo funciona
1. Instala la extensión. Solo actúa en twitch.tv.
2. En un canal con traducción, pulsa 🌐 junto al engranaje y elige idioma.
3. Escucha y lee. Puedes ajustar el volumen de fondo, el retraso y los subtítulos.

Sin cuenta, sin rastreo, sin anuncios. Tus preferencias se guardan en tu navegador.

¿Eres streamer? Activa la traducción en vivo desde decatron.net y tus viewers de otros países te escuchan en el suyo.

## Description (EN)
Decatron Translate adds a 🌐 button to the Twitch player on channels that offer live translation. Pick your language and hear the streamer dubbed in real time, with captions, while their original voice stays in the background. Nobody else notices: the channel, the chat and everyone else stay the same.

How it works
1. Install the extension. It only acts on twitch.tv.
2. On a channel with translation, click 🌐 next to the gear and pick a language.
3. Listen and read. Adjust background volume, delay and captions.

No account, no tracking, no ads. Your preferences live in your browser.

Streamer? Turn on live translation at decatron.net and viewers from other countries hear you in theirs.

## Privacidad (pestaña "Prácticas de privacidad")
- **Política de privacidad (URL):** https://decatron.net/translate#privacy
- **Finalidad única:** reproducir la traducción en vivo del canal de Twitch que el usuario está viendo, en el idioma que elige.
- **Justificación de permisos:**
  - `storage`: guardar preferencias del usuario (idioma preferido, volumen de fondo, subtítulos).
  - Host `https://www.twitch.tv/*`: insertar el botón y los subtítulos en el player y controlar el volumen del video.
  - Host `https://decatron.net/*`: consultar si el canal ofrece traducción y recibir el audio/texto traducido.
- **Uso de datos:** declarar que NO se recogen datos personales, ni de salud, financieros, autenticación, comunicaciones personales, ubicación, historial web, actividad del usuario ni contenido del sitio. Lo único transmitido es el nombre del canal visible y el idioma elegido (no identifican al usuario).
- **Certificaciones:** marcar las tres (no vender datos, no usar para fines ajenos a la funcionalidad, no usar para solvencia/préstamos).

## Recursos gráficos (en esta carpeta)
- `icon-128-chrome.png` — icono de la tienda
- `promo-440x280.png` — tile pequeño (obligatorio)
- `marquee-1400x560.png` — marquee (opcional)
- **Capturas 1280×800 (mínimo 1, máximo 5):** tomar en Twitch real con la app en marcha:
  1. Player con el menú 🌐 abierto (idiomas + oyentes)
  2. Subtítulo en pantalla durante una frase
  3. Popup de la extensión con las preferencias

## Distribución
- Visibilidad: Pública
- Regiones: todas


---

# Borrador para la versión 0.2.0 (nombre: Decatron)

## Datos básicos
- **Nombre:** Decatron
- **Resumen (≤132):** Decatron en Twitch: escucha el stream en tu idioma y ve los emotes de 7TV, BTTV, FFZ y los de cada comunidad de Decatron.

## Descripción (ES)
Decatron reúne en un solo panel lo que Decatron hace por Twitch, por módulos que enciendes y apagas.

• Traducción: en los canales que la ofrecen, escuchas al streamer doblado a tu idioma en tiempo real, con subtítulos. Solo tú lo oyes.
• Emotes: ve en el chat los emotes de 7TV, BetterTTV y FrankerFaceZ, y los propios de cada comunidad de Decatron, sin instalar otras extensiones. Incluye selector: escribe «:» y las primeras letras para elegir un emote.
• Próximamente: puntos de canal automáticos y más.

Cómo usarlo: instala la extensión y abre un canal de Twitch. El botón de Decatron junto al engranaje del player abre el panel.

Sin cuenta, sin anuncios. Tus preferencias se guardan en tu navegador.

## Description (EN)
Decatron brings everything Decatron does for Twitch into one panel, as modules you turn on and off.

• Translation: on channels that offer it, hear the streamer dubbed into your language in real time, with captions. Only you hear it.
• Emotes: see 7TV, BetterTTV and FrankerFaceZ emotes in the chat, plus each Decatron community's own emotes, without installing other extensions. Includes a picker: type ":" and the first letters to choose an emote.
• Coming soon: automatic channel points and more.

How to use it: install the extension and open a Twitch channel. The Decatron button next to the player's gear opens the panel.

No account, no ads. Your preferences live in your browser.

## Privacidad (cambios respecto a la ficha actual)
- **Finalidad única:** mejorar la experiencia de los canales de Twitch que el usuario ve: traducción en vivo y emotes en el chat.
- **Permiso de hosts:** `twitch.tv` (la página), `decatron.net` (traducción y emotes propios), `7tv.io`, `api.betterttv.net` y `api.frankerfacez.com` (sus emotes) y `gql.twitch.tv` (el id del canal para pedir los emotes).
- **Datos:** el login del canal que el usuario está viendo se envía a esos servicios para pedir la traducción y los emotes. No se envía nada más ni se guarda en servidores de Decatron.
- Actualizar la política de privacidad (https://decatron.net/translate#privacy) con esta lista antes de publicar.
