PS C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2> npm run build

> bibliomanager2@0.0.6 build
> npm run build:server && npm run build:client

> bibliomanager2@0.0.6 build:server
> tsc -p tsconfig.json

> bibliomanager2@0.0.6 build:client
> vite build --config client/vite.config.ts

vite v7.1.5 building for production...
✓ 3 modules transformed.
✗ Build failed in 64ms
error during build:
[vite:esbuild] Transform failed with 1 error:
C:/Users/lducreux.PEDAGO/Documents/DevProjects/Bibliomanager2/client/src/App.tsx:2392:14: ERROR: Unterminated regular expression
file: C:/Users/lducreux.PEDAGO/Documents/DevProjects/Bibliomanager2/client/src/App.tsx:2392:14

Unterminated regular expression
2390 |              })}
2391 |            </ul>
2392 |          </div>
     |                ^
2393 |          )}
2394 |        </section>

    at failureErrorWithLog (C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\node_modules\esbuild\lib\main.js:1467:15)
    at C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\node_modules\esbuild\lib\main.js:736:50
    at responseCallbacks.<computed> (C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\node_modules\esbuild\lib\main.js:603:9)
    at handleIncomingPacket (C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\node_modules\esbuild\lib\main.js:658:12)
    at Socket.readFromStdout (C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2\node_modules\esbuild\lib\main.js:581:7)
    at Socket.emit (node:events:518:28)
    at addChunk (node:internal/streams/readable:561:12)
    at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
    at Readable.push (node:internal/streams/readable:392:5)
    at Pipe.onStreamRead (node:internal/stream_base_commons:189:23)
