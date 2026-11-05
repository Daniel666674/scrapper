# Scrapper de fotos de proveedores

Herramienta (TypeScript) para descargar las fotos de producto de las páginas web de tus proveedores autorizados.

## Instalación (una sola vez)
Necesitas [Node.js 20+](https://nodejs.org).
```bash
npm install
```

## Uso
Una o varias páginas de producto:
```bash
npm run scrape -- https://proveedor.com/producto/perfume-x
```
Muchas URLs desde un archivo (una por línea, `#` para comentarios):
```bash
npm run scrape -- -f urls.txt
```
Las fotos se guardan en `descargas/<sitio>/<nombre-del-producto>/01.jpg, 02.jpg…`

## Opciones
| Opción | Qué hace |
|---|---|
| `-a, --all` | Incluye también imágenes secundarias de la página |
| `-o, --out carpeta` | Carpeta de salida |
| `-d, --delay ms` | Pausa entre peticiones (default 1000) |
| `-m, --min-kb kb` | Ignora imágenes más pequeñas (default 15 KB) |
| `--ignore-robots` | No consulta robots.txt (solo con permiso expreso del proveedor) |

## Qué hace por dentro
- Lee datos estructurados (JSON-LD), `og:image`, `<img>`, `srcset`, lazy-load y enlaces de zoom.
- Detecta tiendas Shopify y usa `/products/<handle>.json` para las fotos originales.
- Pide la versión de mayor resolución (quita sufijos `_200x`, `-300x300`).
- Descarta logos/iconos, duplicados y miniaturas.
- Respeta `robots.txt`, espera entre peticiones y reintenta si hay errores.

## Pruebas
```bash
npm test
```

> Úsalo solo con sitios de proveedores que te hayan autorizado a usar sus imágenes. Las fotos siguen siendo propiedad de la marca.
