# Datos históricos

Menús diarios de **La Sazón de Luis**, extraídos del grupo de WhatsApp "La sazón de Luis-Trabajo"
(29/12/2025 – 26/09/2026, 209 días, lunes a sábado).

- `historical_menus.json`: un objeto por día: `date`, `weekday`, `posted_at`, `menu_price`, `entradas[]`, `segundos[]`, `extras[]` (`name`, opcional `price`/`description`).
- `historical_menus.md`: la misma información en formato legible.
- `menus.json`: los mismos menús con nombres **estandarizados** (ortografía, mayúsculas, variantes unificadas).
  Cuando el nombre cambió, `original` guarda cómo se publicó.
- `dishes.json`: catálogo de 171 platos, con `courses`, `category`, `base`/`protein`, `tags`, cuántas veces
  salió, la primera y la última vez, precio usual y las formas de escribirlo que se vieron.
- `dish_aliases.json`: **fuente editable** del catálogo (nombre canónico, categoría, tags, variantes). Para
  corregir o agregar un plato, edita este archivo y corre `python scripts/normalize_menus.py data`.
- `shopping_notes.json`: listas de compras, inventario ("hay…"), faltantes, sobrantes y reglas de cantidad del
  chat, ligadas al menú del día al que corresponden.

Solo se conservaron los mensajes "Hoy en la Sazón de Luis tenemos para degustar". Se descartaron pedidos,
conversaciones, notas de voz e imágenes. Los nombres de los platos se dejaron tal cual se publicaron (con
errores de tipeo y variantes); la normalización queda para la aplicación.

Reglas de extracción (`scripts/extract_menus.py`):
- Un menú publicado después de las 15:00 cuenta como el menú del día siguiente.
- Si hay varias publicaciones para el mismo día, se queda la última (la corregida).
- `*ESPECIAL*` se trata como extras.

Regenerar:

```
python scripts/extract_menus.py "<ruta>/Chat de WhatsApp con La sazón de Luis-Trabajo.txt" data
python scripts/normalize_menus.py data
```

**Privacidad:** los nombres de las personas del grupo se reemplazaron por roles (Cocinera A/B/C, Encargado,
Atención, Ayudante, Comprador). No hay teléfonos ni datos de clientes; los pedidos de mesas no se incluyeron.

`shopping_notes.json` fue curado con IA a partir del chat (una sola vez); no se regenera con un script.
