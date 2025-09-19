vite v7.1.5 building for production...
✓ 4 modules transformed.
✗ Build failed in 76ms
error during build:
[vite:esbuild] Transform failed with 1 error:
C:/Users/lducreux.PEDAGO/Documents/DevProjects/Bibliomanager2/client/src/App.tsx:2073:9: ERROR: The character "}" is not valid inside a JSX element
file: C:/Users/lducreux.PEDAGO/Documents/DevProjects/Bibliomanager2/client/src/App.tsx:2073:9

The character "}" is not valid inside a JSX element
2071 |            </p>
2072 |          )}
2073 |          )}
     |           ^
2074 |        </section>
2075 |        )}

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
