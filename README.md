# Wallapop Tools

Extensión de Chrome para automatizar y optimizar tus ventas en Wallapop. Republica todos tus anuncios con un click, ajusta precios en lote y programa republicaciones automáticas.

**Zero backend.** Todo corre en tu navegador usando tu propia sesión de Wallapop. No se envían datos a servidores externos.

## Funcionalidades

- **Republicar todo** — Refresca todos tus anuncios para que vuelvan a aparecer arriba en el feed
- **Ajuste masivo de precios** — Sube o baja el precio de todos tus productos un porcentaje con un click
- **Republicación automática** — Programa republicaciones cada 6, 12, 24 o 48 horas
- **Dashboard de productos** — Consulta todos tus anuncios, precios y estado desde el toolbar
- **Toolbar flotante** — Controles rápidos directamente en la página de Wallapop

## Cómo funciona

```
1. Abres es.wallapop.com (con tu sesión iniciada)
2. La extensión se inyecta automáticamente en la página
3. Intercepta el token de autenticación de tu sesión activa
4. Usa ese token para realizar las mismas llamadas API que hace Wallapop
5. Todo corre en local — sin servidores, sin enviar datos a terceros
```

## Instalación (desarrollo)

### 1. Clona el repositorio

```bash
git clone git@github.com:Altitud-Studio-S-L-U/wallapop-tools.git
cd wallapop-tools
```

### 2. Genera los iconos

Abre `scripts/generate-icons.html` en Chrome, haz click en **"Download All Icons"** y mueve los 3 PNGs descargados a la carpeta `icons/`, reemplazando los placeholders.

### 3. Carga la extensión en Chrome

1. Abre `chrome://extensions/`
2. Activa **Modo desarrollador** (esquina superior derecha)
3. Click en **"Cargar descomprimida"**
4. Selecciona la carpeta `wallapop-tools`

### 4. Usa la extensión

1. Ve a [es.wallapop.com](https://es.wallapop.com)
2. Navega por la web para que la extensión capture tu token de sesión
3. El toolbar flotante aparecerá abajo a la derecha con el estado **"Conectado"**
4. Usa los botones del toolbar o el popup de la extensión para gestionar tus anuncios

## Estructura del proyecto

```
wallapop-tools/
├── manifest.json                ← Configuración de la extensión (Manifest V3)
├── background/
│   └── service-worker.js        ← Alarmas para republicación programada
├── content/
│   ├── content.js               ← Toolbar flotante + lógica de acciones
│   └── content.css              ← Estilos del toolbar inyectado
├── popup/
│   ├── popup.html               ← Interfaz del popup (click en icono)
│   ├── popup.css                ← Estilos del popup
│   └── popup.js                 ← Lógica: estadísticas, botones, configuración
├── utils/
│   └── wallapop-api.js          ← Interceptor de token + cliente API de Wallapop
├── icons/
│   ├── icon16.png               ← Icono 16x16
│   ├── icon48.png               ← Icono 48x48
│   └── icon128.png              ← Icono 128x128
└── scripts/
    └── generate-icons.html      ← Generador de iconos PNG en el navegador
```

## Arquitectura

```
┌───────────────────────────────────────────────────┐
│                    CHROME                          │
│                                                    │
│  ┌──────────────┐    ┌──────────────────────────┐ │
│  │    Popup      │    │   Content Script          │ │
│  │   (popup.js)  │◄──►│   (content.js)            │ │
│  │   Stats, UI   │    │   Toolbar flotante        │ │
│  └──────┬────────┘    │   Acciones sobre items    │ │
│         │             └──────────┬────────────────┘ │
│         │                        │                   │
│  ┌──────▼────────────────────────▼────────────────┐ │
│  │          Service Worker (background)            │ │
│  │          Alarmas, scheduling, badge             │ │
│  └─────────────────────┬──────────────────────────┘ │
│                        │                             │
│  ┌─────────────────────▼──────────────────────────┐ │
│  │         wallapop-api.js (utils)                 │ │
│  │   - Intercepta fetch/XHR → captura token        │ │
│  │   - getMyItems(), republishItem()               │ │
│  │   - updateItemPrice(), deleteItem()             │ │
│  └─────────────────────┬──────────────────────────┘ │
│                        │                             │
└────────────────────────┼─────────────────────────────┘
                         │ Bearer token (sesión del usuario)
                         ▼
               ┌──────────────────┐
               │ api.wallapop.com │
               └──────────────────┘
```

## API y autenticación

La extensión intercepta las llamadas que hace la propia web de Wallapop para capturar el token de sesión y replicar el mismo patrón de peticiones.

### Mecanismo de autenticación (reverse-engineered)

```
Authorization: Bearer <token>          ← Interceptado de la sesión activa
X-Signature: Base64(HMAC-SHA256(KEY, "{METHOD}|{URL}|{TIMESTAMP}|"))
Timestamp: <unix ms>
DeviceOS: 0                            ← Web client
DeviceID: <fingerprint>                ← Interceptado de la sesión activa
```

Fuentes: [wallapop_secret](https://github.com/rmonvfer/wallapop_secret), [wallapop-go](https://github.com/Neufal777/wallapop-go), [wallapopy](https://github.com/toniprada/wallapopy), [uapop](https://github.com/josemamira/uapop)

### Endpoints verificados (lectura)

Confirmados por clientes open source que interactúan con la API real:

| Acción | Método | Endpoint | Fuente |
|---|---|---|---|
| Perfil de usuario | GET | `/api/v3/users/{id}/` | wallapop-go, wallapopy |
| Productos del usuario | GET | `/api/v3/users/{id}/items` | wallapop-go |
| Reviews del usuario | GET | `/api/v3/users/{id}/reviews` | wallapopy |
| Categorías | GET | `/api/v3/categories` | wallapopy |
| Búsqueda | GET | `/api/v3/general/search` | wallapopy |
| Perks de pago | GET | `/api/v3/payments/perks/me` | uapop |

### Endpoints NO verificados (escritura)

Los endpoints de escritura (republicar, editar precio, reservar, eliminar) **no están documentados en ninguna fuente pública**. Los stubs en `wallapop-api.js` son aproximaciones que deben verificarse manualmente:

1. Abre `es.wallapop.com` con Chrome DevTools (`F12`)
2. Ve a la pestaña **Network** → filtra por `api.wallapop.com`
3. Realiza la acción manualmente (editar precio, reservar, eliminar)
4. Observa la URL, método y body de la petición
5. Actualiza los endpoints en `utils/wallapop-api.js`

> **Importante:** Hasta que no se descubran los endpoints reales de escritura, las funciones de republicar, editar precio y eliminar mostrarán un warning en consola y probablemente fallarán.

## Publicación en Chrome Web Store

1. Registrar cuenta de developer en el [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) ($5 pago único)
2. Generar iconos definitivos con `scripts/generate-icons.html`
3. Enlazar la política de privacidad (ver abajo)
4. Tomar 3-5 screenshots de la extensión en funcionamiento
5. Comprimir la carpeta en `.zip` (excluir `.git/` y `scripts/`)
6. Subir al dashboard, completar descripción y screenshots
7. Enviar a revisión (1-3 días hábiles)

### Política de privacidad

Para la publicación en el Chrome Web Store se requiere una política de privacidad. Se puede usar la de la empresa o crear una específica para la extensión:

- Web de la empresa: [altitudstudio.ad](https://altitudstudio.ad)
- Privacidad: [altitudstudio.ad/ca/privacy](https://altitudstudio.ad/ca/privacy)

## Desarrollo

### Modificar y recargar

1. Edita los archivos del proyecto
2. Ve a `chrome://extensions/`
3. Pulsa el icono de recarga en la tarjeta de la extensión
4. Recarga la pestaña de `es.wallapop.com`

### Consideraciones técnicas

- **Rate limiting**: Las acciones masivas incluyen delays aleatorios (2-5s) entre peticiones para evitar bloqueos por parte de Wallapop
- **Expiración del token**: Si el token caduca, la extensión indica al usuario que navegue por Wallapop para capturar uno nuevo automáticamente
- **Mantenimiento**: Al no existir una API pública oficial de Wallapop, los endpoints pueden cambiar sin previo aviso. Es necesario monitorizar y actualizar cuando sea necesario

## Disclaimer

Este proyecto no está afiliado, asociado, autorizado ni respaldado por Wallapop. Todos los nombres de productos y marcas son propiedad de sus respectivos titulares. El uso de estos nombres es meramente referencial y no implica ninguna asociación.

---

Desarrollado por [Altitud Studio S.L.U.](https://altitudstudio.ad) — Andorra

Contacto: [info@altitudstudio.ad](mailto:info@altitudstudio.ad)
