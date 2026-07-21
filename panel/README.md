# Panel de control · Diego Visuals

Panel para que Diego actualice su portfolio sin tocar código: trabajos (links de YouTube), reseñas, clientes, números, textos, contacto y el vídeo de portada.

## Cómo funciona

- El contenido vive en `data/content.json` (única fuente de verdad).
- Al **publicar**, el servidor regenera las zonas de `../index.html` marcadas con `<!-- ADMIN:X --> ... <!-- /ADMIN:X -->`. La web sigue siendo HTML estático puro.
- Antes de cada publicación se guarda copia en `data/backups/` (máx. 50). Diego puede restaurar desde el panel ("Historial").
- El vídeo de portada se re-codifica a **all-intra** con ffmpeg al subirlo (cada frame keyframe — imprescindible para el scroll-scrub). Si no hay ffmpeg, se usa tal cual y el panel avisa.

## Arrancar en local

```bash
cd pagina-diego/panel
npm install
ADMIN_PASSWORD=loquesea npm start
```

- Web: http://localhost:4173/
- Panel: http://localhost:4173/admin

Sin `ADMIN_PASSWORD` usa `diego2026` (solo para desarrollo).

## Variables de entorno

| Variable | Qué hace | Por defecto |
|---|---|---|
| `ADMIN_PASSWORD` | Contraseña del panel. **Obligatoria en producción.** | `diego2026` |
| `PORT` | Puerto del servidor | `4173` |
| `DATA_DIR` | Dónde viven `content.json` y `backups/` | `panel/data` |
| `UPLOADS_DIR` | Dónde se guardan los archivos subidos | `../assets/uploads` |
| `FFMPEG_PATH` | Ruta a ffmpeg si no está en el PATH | autodetección |

## Modo GitHub Pages (el elegido: panel en el PC de Diego, web gratis)

La web vive en GitHub Pages (`https://piki2066.github.io/diego-visuals/`) y el panel corre en el ordenador de Diego. Al **Publicar**, el servidor local regenera `index.html` y lo sube al repo por la API de GitHub (sin Git instalado); Pages redespliega solo en ~1 minuto. Al **arrancar**, el panel baja de GitHub el `index.html` y `content.json` más recientes — si Alex publica diseño o contenido desde otra máquina, la copia de Diego lo adopta sola (gana la última publicación).

Config en `panel/config.local.json` (**nunca** se sube al repo, está en .gitignore):

```json
{
  "password": "la-contraseña-de-diego",
  "github": {
    "owner": "piki2066",
    "repo": "diego-visuals",
    "branch": "main",
    "token": "github_pat_..."
  }
}
```

**Crear el token (lo hace Alex, 2 min):** github.com → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token. Resource owner: piki2066 · Only select repositories: `diego-visuals` · Repository permissions → **Contents: Read and write**. Caducidad máx. 1 año — apúntate renovarlo.

**Montar el PC de Diego (una vez):**
1. Instalar Node.js LTS desde nodejs.org (siguiente, siguiente).
2. Copiarle la carpeta del repo (o Code → Download ZIP en GitHub y descomprimir).
3. Crear `panel/config.local.json` con la contraseña y el token de arriba.
4. Doble click en `EMPEZAR-PANEL.bat`. La primera vez instala dependencias (incluye ffmpeg para Windows vía `ffmpeg-static`); después arranca y abre el navegador solo.

## Desplegar en Railway (alternativa de pago, sin PC de Diego)

1. Servicio desde este repo con **root directory `pagina-diego`** (¡no `pagina-diego/panel`! — el servidor necesita `index.html` y `assets/`, que viven un nivel arriba). El `pagina-diego/package.json` ya instala las dependencias del panel y arranca el servidor (`npm start`).
2. Variables: `ADMIN_PASSWORD` (una de verdad) y `NIXPACKS_PKGS=ffmpeg` (para re-codificar el vídeo del hero).
3. **Volumen** (imprescindible — el disco de Railway es efímero): monta uno en `/data` y define `DATA_DIR=/data` y `UPLOADS_DIR=/data/uploads`. Al arrancar, el servidor siembra `/data/content.json` con el del repo si no existe, y regenera `index.html` desde el contenido guardado — así ningún redeploy pierde nada.
4. **Primer arranque:** el `.gitignore` excluye los `.mp4`, así que el vídeo del hero no viaja en el repo. Entra en `/admin` y sube el reel desde el panel (queda en el volumen y sobrevive redeploys). Hasta entonces el hero se ve sin vídeo.

## Seguridad

- Login con contraseña → cookie httpOnly (7 días). Límite de 8 intentos / 15 min por IP.
- Todo el texto de Diego se escapa al generar HTML; las URLs se validan (http/https o `assets/...`).
- Los nombres de archivo subido los genera el servidor; extensiones y tamaños con lista blanca por tipo.
- El servidor solo expone `index.html`, `/assets`, `/admin` y la API. Nunca `panel/` ni `data/`.

## Si algo se rompe

- `data/backups/<fecha>/` tiene `content.json` + `index.html` de cada publicación.
- Los marcadores `ADMIN:` de `index.html` no deben borrarse al editar el diseño a mano; si falta alguno, el servidor lo avisa en consola y esa zona deja de actualizarse (el resto sigue funcionando).
