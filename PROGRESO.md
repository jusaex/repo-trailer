# repo-trailer: progreso

Objetivo: un proyecto de GitHub que consiga muchas estrellas.
Idea: un plugin para Claude Code (`/trailer`) que ejecuta tu proyecto, graba una demo animada (SVG) y escribe el README.

## Hecho (2026-10-18)
- `skills/trailer/scripts/term-svg.mjs`: graba comandos reales y crea un SVG animado de terminal. No necesita nada instalado.
- `skills/trailer/scripts/web-svg.mjs`: usa el Chrome/Edge del ordenador para hacer clics y capturas, y crea un SVG animado. No necesita nada instalado.
- `skills/trailer/SKILL.md`: instrucciones para el agente.
- `.claude-plugin/`: plugin y marketplace para instalarlo con `/plugin`.
- README, licencia MIT y ejemplos en `examples/`. Para ver los ejemplos, abre `examples/preview.html`.

## Falta
- Crear el repositorio `jusaex/repo-trailer` en GitHub y subirlo.
- Probar `/trailer` de principio a fin en un proyecto ajeno.
- Comprobar en GitHub que los SVG se mueven dentro del README.
- Publicarlo en Reddit, Hacker News, X, etc.
