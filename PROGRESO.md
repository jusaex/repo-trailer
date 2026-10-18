# repo-trailer: progreso

Objetivo: un proyecto de GitHub que consiga muchas estrellas.
Idea: un plugin para Claude Code (`/trailer`) que ejecuta tu proyecto, graba una demo animada (SVG) y escribe el README.

## Hecho (2026-10-18)
- `skills/trailer/scripts/term-svg.mjs`: graba comandos reales y crea un SVG animado de terminal. No necesita nada instalado.
- `skills/trailer/scripts/web-svg.mjs`: usa el Chrome/Edge del ordenador para hacer clics y capturas, y crea un SVG animado. No necesita nada instalado.
- `skills/trailer/SKILL.md`: instrucciones para el agente.
- `.claude-plugin/`: plugin y marketplace para instalarlo con `/plugin`.
- README, licencia MIT y ejemplos en `examples/`. Para ver los ejemplos, abre `examples/preview.html`.
- Subido a GitHub: https://github.com/jusaex/repo-trailer. Los SVG se mueven dentro del README.
- Probado con un proyecto de otra persona: el juego 2048. La demo está en `examples/2048/`. Durante la prueba se arreglaron varias cosas:
  - Los archivos JSON con BOM (marca invisible de Windows) ya no rompen el programa.
  - Si una página no abre, ahora da un error claro en vez de esperar 20 segundos.
  - Se pueden pulsar varias teclas en un solo paso: `"press": ["ArrowLeft", "ArrowDown"]`.
  - El texto de cada foto va en una franja debajo, así no tapa la página.

## Falta
- Probarlo instalado de verdad con `/plugin install` en Claude Code.
- Publicarlo en Reddit, Hacker News, X, etc.
