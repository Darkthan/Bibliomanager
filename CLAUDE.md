# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Development
- `npm run dev` - Runs both backend server and frontend client concurrently
- `npm run dev:server` - Backend only (Express server with tsx watch on src/index.ts)
- `npm run dev:client` - Frontend only (Vite dev server on port 5173)

### Building
- `npm run build` - Build both server and client for production
- `npm run build:server` - TypeScript compilation to dist/
- `npm run build:client` - Vite build to dist/client/

### Testing
- `npm test` - Run all tests (Vitest)
- `npm run test:server` - Server-side tests only (Node environment)
- `npm run test:client` - Client-side tests only (jsdom environment)

### Code Quality
- `npm run lint` - ESLint check
- `npm run format` - Prettier formatting

### Production
- `npm start` - Start production server (runs dist/index.js)

## Architecture Overview

### Project Structure
This is a TypeScript monorepo with separate server and client applications:

```
src/               # Backend code (Node.js/Express)
  index.ts         # Entry point, starts HTTP server
  server.ts        # Main server implementation with full app logic
client/            # Frontend code (React/Vite)
  src/             # React components and app logic
  vite.config.ts   # Vite configuration with proxy to backend
tests/             # Server tests (mirrors src/)
client/tests/      # Client tests
```

### Technology Stack
- **Backend**: Node.js, TypeScript, Express (embedded in server.ts)
- **Frontend**: React 18, Vite, TypeScript
- **Testing**: Vitest with separate environments (Node for server, jsdom for client)
- **Development**: tsx for TypeScript execution, concurrently for parallel dev servers

### Server Architecture
The server is implemented as a single large file (src/server.ts) containing:
- HTTP server with routing
- Static file serving for the built React app
- API endpoints for library management (books, loans, users)
- File upload handling
- Authentication and session management
- Database operations (currently file-based)

### Client Architecture
- Single-page React application
- Vite for development and building
- Proxy configuration routes API calls to backend during development
- Built files served by the Node.js server in production

### Development Workflow
1. Run `npm run dev` to start both servers
2. Frontend runs on http://localhost:5173 (Vite dev server)
3. Backend runs on http://localhost:3000
4. Vite proxies API calls (/api, /health, /covers) to the backend
5. In production, the Node server serves the built React app

### Configuration
- Environment variables: Use .env file (see .env.example)
- Default port: 3000 (configurable via PORT env var)
- TypeScript config: Standard ES2020/ESNext setup
- ESLint: Configured for TypeScript with relaxed rules for development speed

### Testing Setup
- Vitest with multi-project configuration
- Server tests use Node environment
- Client tests use jsdom with React Testing Library
- Test files should mirror the source structure

### Key Patterns
- Server-side code uses Node.js built-in modules extensively
- Frontend uses React Router for navigation
- File-based data storage (JSON files in data/ directory)
- Environment-based configuration (development vs production)

### Domain Context
Bibliomanager is a library management system focusing on:
- Book catalog management
- User/patron management  
- Loan/borrowing system
- Physical item tracking (RFID integration planned)
- Print services for labels