 npm run start

> bibliomanager2@0.0.1 start
> node dist/index.js

HTTP server listening on http://localhost:3000
PS C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2> npm run build

> bibliomanager2@0.0.1 build
> npm run build:server && npm run build:client

> bibliomanager2@0.0.1 build:server
> tsc -p tsconfig.json

> bibliomanager2@0.0.1 build:client
> vite build --config client/vite.config.ts

vite v7.1.5 building for production...
✓ 26 modules transformed.
../dist/client/index.html                  0.33 kB │ gzip:  0.24 kB
../dist/client/assets/index-DRiKHlb1.js  162.89 kB │ gzip: 51.72 kB
✓ built in 530ms
PS C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2> npm run start

> bibliomanager2@0.0.1 start
> node dist/index.js

HTTP server listening on http://localhost:3000
PS C:\Users\lducreux.PEDAGO\Documents\DevProjects\Bibliomanager2> npm run build

> bibliomanager2@0.0.1 build
> npm run build:server && npm run build:client

> bibliomanager2@0.0.1 build:server
> tsc -p tsconfig.json

> bibliomanager2@0.0.1 build:client
> vite build --config client/vite.config.ts

vite v7.1.5 building for production...
✓ 3 modules transformed.
✗ Build failed in 58ms
error during build:
[vite:esbuild] Transform failed with 1 error:
C:/Users/lducreux.PEDAGO/Documents/DevProjects/Bibliomanager2/client/src/App.tsx:746:7: ERROR: The character "}" is not valid inside a JSX element
file: C:/Users/lducreux.PEDAGO/Documents/DevProjects/Bibliomanager2/client/src/App.tsx:746:7

The character "}" is not valid inside a JSX element
744 |        </section>
745 |        )}
746 |        )}
    |         ^
747 |
748 |        {route === '/livres/disponibles' && (

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
