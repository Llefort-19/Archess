import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { config } from 'dotenv';
import { GameManager } from './services/GameManager';
import { LobbyManager } from './services/LobbyManager';
import { GameAction } from '@archess/shared';
import { JoinMatchRequest, Match } from '../../shared/types/lobby';

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

// Initialize managers
const gameManager = new GameManager();
const lobbyManager = new LobbyManager();

// Track player connections
const connectedPlayers = new Map<string, { playerId: string; matchId: string }>();

// Lobby API Routes
app.get('/api/lobby/matches', (req, res) => {
  try {
    console.log('GET /api/lobby/matches - Listing matches');
    const activeMatches = lobbyManager.listMatches();
    const completedMatches = lobbyManager.listCompletedMatches();
    console.log(`Found ${activeMatches.length} active matches and ${completedMatches.length} completed matches`);
    res.json({ 
      activeMatches,
      completedMatches
    });
  } catch (error) {
    console.error('Error in GET /api/lobby/matches:', error);
    res.status(500).json({ error: 'Failed to list matches' });
  }
});

app.post('/api/lobby/create', (req, res) => {
  try {
    console.log('POST /api/lobby/create - Creating new match');
    const { playerName } = req.body;
    
    if (!playerName) {
      return res.status(400).json({ error: 'Player name is required' });
    }
    
    const match = lobbyManager.createMatch(playerName);
    
    // Initialize game state for this match
    console.log(`Initializing game state for match ${match.id}`);
    gameManager.initializeGame(match.id);
    
    // Broadcast new match to all connected clients
    console.log('Broadcasting match creation to all clients');
    io.emit('matchCreated', match);
    
    res.json({ match });
  } catch (error) {
    console.error('Error in POST /api/lobby/create:', error);
    res.status(500).json({ error: 'Failed to create match' });
  }
});

app.post('/api/lobby/join', (req, res) => {
  try {
    const joinRequest: JoinMatchRequest = req.body;
    console.log(`POST /api/lobby/join - Joining match ${joinRequest.matchId} as ${joinRequest.role}`);
    
    const result = lobbyManager.joinMatch(
      joinRequest.matchId,
      joinRequest.role,
      joinRequest.playerName
    );

    if (!result.success) {
      console.log(`Failed to join match: ${result.error}`);
      return res.status(400).json(result);
    }

    // Broadcast match update to all connected clients
    console.log(`Match ${joinRequest.matchId} updated, broadcasting to clients`);
    io.emit('matchUpdated', result.match);
    
    res.json(result);
  } catch (error) {
    console.error('Error in POST /api/lobby/join:', error);
    res.status(500).json({ error: 'Failed to join match' });
  }
});

// Game API Routes
app.get('/api/game/:matchId', (req, res) => {
  try {
    const { matchId } = req.params;
    console.log(`GET /api/game/${matchId} - Fetching game state`);
    
    const gameState = gameManager.getGameState(matchId);
    if (!gameState) {
      console.log(`Game state not found for match ${matchId}`);
      return res.status(404).json({ error: 'Game not found' });
    }
    
    console.log(`Returning game state for match ${matchId}`);
    res.json(gameState);
  } catch (error) {
    console.error(`Error in GET /api/game/${req.params.matchId}:`, error);
    res.status(500).json({ error: 'Failed to get game state' });
  }
});

app.post('/api/game/:matchId/reset', async (req, res) => {
  try {
    const { matchId } = req.params;
    const gameState = await gameManager.initializeGame(matchId);
    io.to(matchId).emit('gameStateUpdate', gameState);
    res.json(gameState);
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset game' });
  }
});

// Handle player exit from match
app.post('/api/game/:matchId/exit', (req, res) => {
  try {
    const { matchId } = req.params;
    const { playerId } = req.body;

    if (!playerId) {
      return res.status(400).json({ error: 'Player ID is required' });
    }

    // Handle the player exit in the lobby manager
    const updatedMatch = lobbyManager.handlePlayerExit(matchId, playerId);

    // If match was removed (single player), emit matchRemoved event
    if (!updatedMatch) {
      io.emit('matchRemoved', matchId);
    } else {
      // If match was updated (two players), emit matchUpdated event
      io.emit('matchUpdated', updatedMatch);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error handling player exit:', error);
    res.status(500).json({ error: 'Failed to handle player exit' });
  }
});

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Handle player identification
  socket.on('setPlayer', (data: { playerId: string, matchId: string }, callback) => {
    try {
      const { playerId, matchId } = data;
      console.log(`Player ${playerId} identified with socket ${socket.id} for match ${matchId}`);
      
      // Set up the player connection
      connectedPlayers.set(socket.id, { playerId, matchId });
      
      // Join the socket to the match room
      socket.join(matchId);
      
      // Send acknowledgment response directly
      if (callback) {
        callback(null);
      }
      
      // Additionally emit playerConnected event to the client
      const response = { playerId, matchId };
      socket.emit('playerConnected', response);
      
    } catch (error: any) {
      console.error('Error setting player:', error);
      if (callback) callback({ message: error.message || 'Failed to set player' });
    }
  });
  
  // Handle game actions
  socket.on('gameAction', async (action, callback) => {
    try {
      console.log(`Received game action from ${socket.id} (Player ${connectedPlayers.get(socket.id)?.playerId || 'unknown'}):`, action);
      
      // Extract matchId from the action itself
      const matchId = action.matchId;
      if (!matchId) {
        const error = new Error('No match ID provided with action');
        console.error(error.message);
        socket.emit('actionError', { message: 'No match ID provided with action' });
        if (callback) callback({ message: 'No match ID provided with action' });
        return;
      }
      
      // Get the match from the lobby manager
      const match = lobbyManager.getMatch(matchId);
      if (!match) {
        const error = new Error('Match not found');
        console.error(error.message);
        socket.emit('actionError', { message: 'Match not found' });
        if (callback) callback({ message: 'Match not found' });
        return;
      }
      
      // Check if both players have joined the match
      if (action.playerId === 'player1' && (!match.player2 || match.status !== 'in_progress')) {
        const error = new Error('Waiting for Player 2 to join');
        console.error(error.message);
        socket.emit('actionError', { message: 'Waiting for Player 2 to join', code: 'WAITING_FOR_PLAYER2' });
        if (callback) callback({ message: 'Waiting for Player 2 to join', code: 'WAITING_FOR_PLAYER2' });
        return;
      }
      
      // Verify the player is associated with this match
      const playerId = connectedPlayers.get(socket.id)?.playerId;
      const playerMatchId = connectedPlayers.get(socket.id)?.matchId;
      
      if (!playerId) {
        const error = new Error('Player not identified');
        console.error(error.message);
        socket.emit('actionError', { message: 'Player not identified' });
        if (callback) callback({ message: 'Player not identified' });
        return;
      }
      
      if (playerMatchId !== matchId) {
        console.log(`Player ${playerId} is trying to act on match ${matchId} but is associated with match ${playerMatchId}`);
        // Re-associate player with the match they're trying to act upon
        connectedPlayers.set(socket.id, { playerId, matchId });
      }
      
      // Process the action
      await gameManager.handleAction(action);
      
      // If we get here, the action was successful
      if (callback) callback(null);
      
      // Broadcast updated game state to all clients in this match
      const updatedState = gameManager.getGameState(matchId);
      
      io.emit('gameStateUpdate', updatedState);
    } catch (error: any) {
      console.error('Error handling game action:', error);
      socket.emit('actionError', { message: error.message || 'Unknown error' });
      if (callback) callback({ message: error.message || 'Unknown error' });
    }
  });
  
  socket.on('disconnect', () => {
    const connection = connectedPlayers.get(socket.id);
    console.log(`User disconnected: ${socket.id} (Player ${connection?.playerId || 'unknown'})`);
    
    if (connection) {
      socket.leave(connection.matchId);
    }
    
    // Remove from connected players
    connectedPlayers.delete(socket.id);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Clean up old matches periodically
  setInterval(() => {
    lobbyManager.cleanupOldMatches();
  }, 60 * 60 * 1000); // Every hour
}); 