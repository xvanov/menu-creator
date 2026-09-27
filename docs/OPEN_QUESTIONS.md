# Preguntas abiertas — La Sazón de Luis

> **Actualización 26/09:** ya están respondidas las preguntas 1, 2, 7, 8, 9, 11, 13, 14, 15, 16 (parcial), 21, 22, 23 y 25.
> Ver la tabla de decisiones en `docs/PRD.md` §11. Siguen abiertas: 3, 5, 6, 10, 12, 17, 18, 19, 20, 24 y 26.

Para cerrar el PRD (`docs/PRD.md`). Las respuestas cambian las reglas del menú y cómo calculamos las compras.
Entre paréntesis: lo que vimos en el historial de WhatsApp (dic 2025 – sep 2026, 209 días).

## A. Estructura del menú

1. **¿Cuántas entradas y cuántos segundos?** Nos dijeron 4 entradas + 5 segundos. En el historial lo normal es
   **3 entradas + 4 segundos** (136 de 209 días); 4 + 5 salió solo 11 veces. ¿Cuál debe ser el objetivo? ¿Cambia según el día?
2. **¿La menestra es todos los días?** En el historial siempre hay menestra lunes, martes y viernes; los miércoles
   y jueves más o menos la mitad de las veces; los sábados casi nunca. ¿Así debe seguir?
3. **Días fijos:** casi siempre hay **lentejas los lunes** y **frijoles los viernes**. ¿Es una regla o costumbre?
   ¿Hay otras (por ejemplo, pescado algún día fijo)?
4. **¿Siempre una sopa o crema entre las entradas?** (Sí, los 209 días.)
5. **¿Hay platos que deben estar siempre?** (Papa a la huancaína y Tamal salen muy seguido; Pollo broaster casi
   siempre como extra.)
6. **¿Cada cuántos días se puede repetir un plato?** (En promedio vuelve a los 9 días.)
7. **¿Atienden domingos o cenas?** En el chat se habla de "la cena" y "el arroz para la noche". ¿El programa debe
   planear también la cena o solo el almuerzo?
8. **¿Hay dos puestos?** El chat menciona "al frente" y "el otro puesto". ¿Se cocina distinto en cada uno? ¿La lista
   de compras es una sola o una por puesto?

## B. Combinaciones

9. **Reglas de combinación:** ya tenemos "sopa o crema de legumbre (crema de arveja, menestrón, shambar) no va con
   menestra". (Pasó 5 veces en el historial, por ejemplo el 19/03: crema de arveja + arvejita partida.)
   **¿Qué otras combinaciones no van?** Por ejemplo:
   - ¿dos frituras en el mismo día?
   - ¿dos platos con chancho?
   - ¿dos platos con papa a la huancaína?
   - ¿más de dos guisos de pollo?
   - ¿algo que no va con sopas pesadas (patasca, sancochado, caldo de mote)?
10. **¿Qué platos consideran "pesados"?** Marcamos: menestras (sobre todo frijoles, garbanzo, pallares), carapulcra,
    patita con maní, pachamanca, guiso de trigo, patasca, sancochado, sopa de morón, shambar. ¿Está bien?
11. **Platos nuevos:** ¿el programa puede proponer platos nuevos cada semana? ¿Cuántos? ¿Siempre necesitan
    aprobación antes de salir?

## C. Precios y extras

12. **¿El menú siempre cuesta S/13?** ¿Quién cambia el precio y cada cuánto?
13. **Extras:** vimos Pollo broaster S/15, Trucha frita S/20, Churrasco/Bistec a lo pobre S/17–20, Arroz chaufa S/15,
    y especiales (Pachamanca 3 sabores S/35, Cuy chactado S/60). Nos mencionaron también Lomo saltado S/17 (en el
    chat salió a S/12). ¿Cuál es la lista actual de extras y precios? ¿Cuántos extras por día?

## D. Cantidades y compras

14. **¿Cuántos menús venden al día, más o menos?** ¿Y cuántos de cada segundo? ¿Varía por día de la semana?
    (Podemos estimarlo de los pedidos "Mesa…" en el chat, pero sería mejor un número real.)
15. **Recetas:** para calcular compras necesitamos cuánto lleva cada plato por porción (por ejemplo, "Estofado de pollo:
    1 presa, 150 g papa, …"). ¿Quién nos puede dar las recetas de los 20 platos más comunes? El programa puede
    hacer un primer borrador y la cocinera lo corrige.
16. **¿Cuándo se hace la lista de compras y quién compra?** (En el chat, la cocinera manda la lista en la noche.)
    ¿Dónde compran (mercado, pollería, carnicería, abarrotes)? ¿En qué unidades (kilos, atados, unidades, jabas)?
17. **Stock ("Hay…"):** ¿la cocinera puede escribir en la app lo que hay antes de hacer la lista? ¿Y al cerrar el
    día, lo que sobró y lo que se acabó? Con eso el programa aprende más rápido.
18. **Reglas de cantidad que ya usan:** vimos "Si hay tallarín, arroz con pollo, chaufa o jardinera, solo 3 kg de
    arroz; si no, 5 kg". ¿Hay otras reglas así (papa, cebolla, pollo)?
19. **Fotos del chat:** hay 409 fotos en el grupo. Algunas parecen listas de compras escritas a mano
    ("eso es la lista para que mande por WhatsApp"). ¿Quieren que las leamos también?

## E. Diseño, uso y web

20. **Archivos del diseño:** la plantilla necesita el banner (`assets/banner.png`) y las fuentes y estilos
    (`support.js`, `_ds/...`). ¿Nos los pueden mandar?
21. **¿A qué hora se decide y se publica el menú?** (El chat muestra menús en la noche para el día siguiente y
    también en la mañana.) ¿El programa debe tener el menú listo la noche anterior?
22. **¿Solo post (1080×1350) o también estado/story (1080×1920)?** ¿Se publica en WhatsApp, Instagram, Facebook?
23. **¿Quién usa la app y desde qué?** (¿Celular?) ¿Basta con una sola clave compartida?
24. **Nombres de los platos:** estandarizamos la ortografía, por ejemplo "Arvejita partida" (no alverjita),
    "Frijoles" (no fréjoles), "Wantán", "Bistec", "Ocopa arequipeña". ¿Prefieren otra forma?
25. **Web / IA más adelante:** para usarla en internet (Vercel) sin la computadora prendida, la IA necesitaría una
    API key de Anthropic (costo aproximado: centavos por día). ¿Está bien para una segunda etapa, o prefieren que la
    IA solo funcione desde la computadora?
26. **Costos:** ¿más adelante quieren ver el costo por plato o por menú? (Ayudaría a decidir precios de los extras.)
