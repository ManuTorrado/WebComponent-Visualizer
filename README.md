# Web Component Visualizer

Previsualiza e interactúa con Web Components dentro de VS Code. Un único proceso Chromium se precarga y se reutiliza entre vistas y recargas; cada panel tiene un contexto aislado. El navegador ejecuta el componente y envía sus imágenes al editor, que devuelve los eventos de ratón y teclado.

## Probar en desarrollo

Requisitos: Node.js 22 y VS Code 1.99 o superior.

```sh
npm ci
npm run browser:install
npm run compile
```

Pulsa **F5** para abrir un Extension Development Host con la carpeta `examples`. Abre `counter-card.ts` y pulsa el icono de previsualización del editor, o ejecuta **Web Components: Preview Component** desde la paleta de comandos. También está disponible en el menú contextual del explorador.

## Instalar la extensión

```sh
npm run package
code --install-extension wc-visualizer-linux-x64-0.1.0.vsix
```

El paquete se genera para el sistema y arquitectura de la máquina que lo compila, ya que incluye el binario nativo de esbuild. En otra plataforma, genera allí el paquete. Chromium se descarga por separado: ejecuta **Web Components: Install Chromium** en VS Code, o configura `wcVisualizer.executablePath` con la ruta de Chrome/Chromium ya instalado. En Linux, Playwright puede requerir librerías del sistema; los detalles de instalación se muestran en Output → Web Component Visualizer.

## Uso

1. Abre la carpeta del proyecto y un archivo `.js`, `.ts`, `.mjs`, `.jsx` o `.tsx` que registre un custom element al importarse.
2. Ejecuta **Web Components: Preview Component**. Reconoce registros `customElements.define('my-tag', ...)` y decoradores `@customElement('my-tag')`. Si hay varias etiquetas, permite elegir; si el nombre es dinámico, puedes escribirlo. Las etiquetas registradas en ejecución también aparecen como sugerencias en el panel.
3. Ajusta el viewport, el fondo, atributos JSON, propiedades JSON o contenido HTML para slots y pulsa **Aplicar**.
4. Haz clic en la vista para interactuar. El teclado permite escribir, borrar y navegar con Tab dentro del componente. Escape devuelve el foco al editor.
5. Guarda el componente o cualquiera de sus dependencias para reconstruir y recargar. La recarga conserva las opciones del panel y reinicia el estado interno del componente. Solo se previsualizan cambios guardados.

Ejemplo para `counter-card.ts`:

```json
{ "label": "Mi contador", "accent": "#087f8c" }
```

Ponlo en **Atributos**. Para un slot, usa `<p slot="description">Contenido personalizado</p>` en **Contenido / slots**. Los atributos `true` se incluyen como atributos booleanos; `false` y `null` los omiten. Las propiedades admiten estructuras JSON y se asignan antes de conectar el elemento al DOM.

## Compatibilidad y límites

- Web Components nativos, Lit y otras librerías que registren custom elements. Instala sus dependencias en el proyecto que estás previsualizando.
- esbuild compila TypeScript, JSX, imports CSS y recursos importados comunes; respeta el `tsconfig.json` del proyecto, incluidos aliases y opciones de decoradores. Lit con decoradores tradicionales requiere `experimentalDecorators: true` y `useDefineForClassFields: false`.
- No ejecuta la configuración o los plugins de Vite/Webpack. Los componentes que dependan del arranque de una aplicación, de APIs globales o de transformaciones específicas requieren un archivo de entrada que prepare ese entorno. Las rutas absolutas a recursos de `public/` no se sirven automáticamente; usa imports que pueda resolver esbuild.
- La vista es una transmisión de imágenes, no un DOM integrado en el webview. Soporta ratón, scroll y teclado básico; no ofrece selección de texto del navegador, DevTools incrustadas, portapapeles, IME, gestos táctiles ni fidelidad de vídeo. Los diálogos se descartan y las ventanas emergentes se cierran. Los errores de ejecución y compilación aparecen en el panel; los mensajes del componente están en Output.
- Se ejecuta únicamente en workspaces de confianza. El servidor temporal escucha en `127.0.0.1`, con un puerto aleatorio y una ruta de acceso aleatoria; sirve los bundles en memoria. No modifica el proyecto que se previsualiza.
- Los paneles ocultos pausan capturas. Cerrar un panel libera su contexto, servidor y compilador, manteniendo Chromium disponible. **Web Components: Stop Background Browser** cierra todos los paneles y el proceso; una nueva previsualización lo reinicia. Salir de VS Code también lo libera.
- En SSH/WSL/Dev Containers, Chromium y sus dependencias deben estar instalados en el entorno donde corre la extensión. Los frames viajan por la mensajería de VS Code, sin exponer el puerto local al cliente.

## Configuración

| Opción | Predeterminado | Función |
| --- | --- | --- |
| `wcVisualizer.prewarm` | `true` | Inicia Chromium al abrir un workspace de confianza si ya está instalado. |
| `wcVisualizer.executablePath` | `""` | Usa una instalación existente de Chromium/Chrome. Reinicia el navegador con el comando Stop después de cambiarla. |
| `wcVisualizer.frameInterval` | `250` | Intervalo entre capturas en milisegundos (100–2000). Solo se envían imágenes que hayan cambiado. |

Si Chromium no está instalado, la precarga registra el aviso en Output sin interrumpir el editor. Al abrir una vista, se ofrece el comando de instalación. No hay descargas automáticas al activar la extensión.

## Validación

```sh
npm run check
npm test
npm run browser:install
npm run test:browser
npm run package
```

La prueba de integración usa Chromium real: verifica reutilización concurrente, aislamiento de contextos, TypeScript y CSS, Shadow DOM, atributos, propiedades, slots, ratón, teclado, capturas, recarga de dependencias, recuperación tras errores y liberación de recursos. La interfaz de VS Code se puede revisar con F5.

También puedes probar automáticamente la interfaz con una instalación local de VS Code y una sesión gráfica. Usa la ruta al binario Electron, por ejemplo en Linux:

```sh
VSCODE_EXECUTABLE=/usr/share/code/code npm run test:vscode
```

Esta prueba abre un perfil temporal, comprueba la activación y los comandos, espera una imagen real dentro del webview, aplica atributos y cierra los paneles y el navegador. Para guardar una captura, añade `WC_VISUALIZER_SCREENSHOT=/tmp/wc-preview.png`.

Referencias: [Webviews de VS Code](https://code.visualstudio.com/api/extension-guides/webview), [API de Playwright](https://playwright.dev/docs/api/class-browser), [reconstrucción incremental de esbuild](https://esbuild.github.io/api/#rebuild).
