# Archess

A modern browser-based version of Archon, combining turn-based strategy with real-time arcade battles.

## Project Structure

```
archess/
├── client/           # React-based frontend
├── server/           # Node.js/Express backend
└── shared/           # Shared types and interfaces
```

## Features

- Grid-based board with fantasy-themed units
- Turn-based movement and strategy
- Real-time arcade battles when units meet
- WebSocket-based real-time updates
- Modern React frontend with TypeScript
- Authoritative server architecture

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm (v8 or higher)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/archess.git
cd archess
```

2. Install dependencies:
```bash
npm install
```

3. Start the development servers:
```bash
npm run dev
```

This will start both the client (port 3000) and server (port 4000) in development mode.

### Development

- Client: http://localhost:3000
- Server: http://localhost:4000

## Architecture

### Client (React + TypeScript)
- Modern React with hooks
- TypeScript for type safety
- Vite for fast development
- Socket.IO for real-time communication

### Server (Node.js + Express)
- Express for REST API
- Socket.IO for real-time updates
- TypeScript for type safety
- Modular architecture with clear interfaces

### Shared
- Common types and interfaces
- Shared game logic
- Type definitions

## Testing

Run tests for all packages:
```bash
npm test
```

Run tests for specific package:
```bash
npm test --workspace=@archess/client
npm test --workspace=@archess/server
```

## Building for Production

```bash
npm run build
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 