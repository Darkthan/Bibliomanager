✓ 3 modules transformed.
✗ Build failed in 59ms
error during build:
[vite:esbuild] Transform failed with 1 error:
C:/Users/lducreux.PEDAGO/Documents/DevProjects/Bibliomanager2/client/src/App.tsx:701:34: ERROR: Unexpected "}"
file: C:/Users/lducreux.PEDAGO/Documents/DevProjects/Bibliomanager2/client/src/App.tsx:701:34

Unexpected "}"
699 |                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
700 |                        { (s.isbn13 || s.isbn10) ? (
701 |                          <img src={} alt="" width={36} height={54} style={{ objectFit: 'cover', borderRadius: 4 }} />
    |                                    ^
702 |                        ) : (
703 |                          s.coverUrl ? <img src={s.coverUrl} alt="" width={36} height={54} style={{ objectFit: 'cover',...

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
