# Archess

A modern browser-based chess-inspired strategy game with a turn-based gameplay experience.

## Project Structure

```
archess/
├── client/           # React-based frontend using Vite
├── server/           # Node.js backend with Socket.IO
└── shared/           # Shared types and interfaces
```

## Features

- Grid-based board with strategic gameplay
- Turn-based movement system
- Real-time multiplayer using WebSockets
- Game lobbies for match creation and joining
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

### Running the Development Servers

Start the client development server:
```bash
cd client
npm run dev
```

Start the server development server:
```bash
cd server
npm run dev
```

### Development URLs

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
- Modular architecture with services:
  - GameManager: Handles game state and logic
  - LobbyManager: Manages game lobbies and matchmaking

### Shared
- Common types and interfaces
- Shared game logic
- Type definitions

## Building for Production

```bash
# Build the client
cd client
npm run build

# Build the server
cd server
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