import { io, Socket } from 'socket.io-client';
import { GameState, GameAction, INetworkManager, BattleState, Unit } from '@archess/shared';
import { Match } from '../../../shared/types/lobby';

class NetworkManager implements INetworkManager {
  private socket: Socket | null = null;
  private isConnected = false;
  private playerId: string | null = null;
  private currentMatchId: string | null = null;
  
  /**
   * Gets the socket instance
   */
  getSocket(): Socket | null {
    return this.socket;
  }
  
  /**
   * Set the player ID for this client
   */
  setPlayerId(playerId: string, matchId: string): Promise<void> {
    console.log(`Setting player ID to ${playerId} for match ${matchId}`);
    this.playerId = playerId;
    this.currentMatchId = matchId;
    
    if (!this.socket) {
      console.error('No socket connection available, attempting to connect');
      return this.connect().then(() => this.setPlayerId(playerId, matchId));
    }
    
    if (!this.socket.connected) {
      console.error('Socket exists but not connected, attempting to reconnect');
      return this.connect().then(() => this.setPlayerId(playerId, matchId));
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error(`Player identification timed out after 5 seconds`);
        this.socket?.off('playerConnected', successListener);
        reject(new Error('Player identification timed out'));
      }, 5000);
      
      const successListener = (data: { playerId: string, matchId: string }) => {
        if (data.playerId === playerId && data.matchId === matchId) {
          clearTimeout(timeout);
          this.socket?.off('playerConnected', successListener);
          console.log(`Player identification confirmed: ${playerId} in match ${matchId}`);
          resolve();
        }
      };
      
      this.socket.on('playerConnected', successListener);
      
      // Emit the setPlayer event
      this.socket.emit('setPlayer', { playerId, matchId }, (error: any) => {
        if (error) {
          clearTimeout(timeout);
          this.socket?.off('playerConnected', successListener);
          console.error('Error setting player ID:', error);
          reject(new Error(error.message || 'Failed to set player ID'));
        }
      });
    });
  }
  
  /**
   * Gets the current player ID
   */
  getPlayerId(): string | null {
    return this.playerId;
  }

  /**
   * Gets the current match ID
   */
  getMatchId(): string | null {
    return this.currentMatchId;
  }

  /**
   * Returns whether the socket is connected
   */
  getConnectionStatus(): boolean {
    return this.isConnected && this.socket?.connected === true;
  }

  /**
   * Connects to the game server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('Attempting to connect to server at http://localhost:4000');
        this.socket = io('http://localhost:4000');
        
        this.socket.on('connect', () => {
          console.log('Socket connected successfully!');
          this.isConnected = true;
          
          // If we have a player ID and match ID, set them immediately
          if (this.playerId && this.currentMatchId) {
            this.socket?.emit('setPlayer', { 
              playerId: this.playerId,
              matchId: this.currentMatchId
            });
            console.log(`Re-establishing player ID ${this.playerId} for match ${this.currentMatchId}`);
          }
          
          resolve();
        });
        
        this.socket.on('connect_error', (error) => {
          console.error('Socket connection error:', error);
          reject(error);
        });
      } catch (error) {
        console.error('Error creating socket:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Disconnects from the game server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.isConnected = false;
      this.playerId = null;
      this.currentMatchId = null;
    }
  }
  
  /**
   * Sends a game action to the server
   */
  async sendAction(action: GameAction, explicitMatchId?: string): Promise<void> {
    if (!this.socket) {
      await this.connect();
    }

    if (!this.socket || !this.socket.connected) {
      throw new Error('Socket not connected');
    }

    // Use the explicit match ID if provided, otherwise use the current match ID
    const matchId = explicitMatchId || this.currentMatchId;
    
    if (!matchId) {
      throw new Error('No active match ID available');
    }

    // Always include the matchId in the action object itself
    const actionWithMatchId = {
      ...action,
      matchId
    };
    
    console.log(`Sending action to match ${matchId}:`, actionWithMatchId);
    
    return new Promise((resolve, reject) => {
      // Set a timeout for the request
      const timeout = setTimeout(() => {
        this.socket?.off('gameStateUpdate', successListener);
        this.socket?.off('actionError', errorListener);
        reject(new Error('Action timed out'));
      }, 5000); // 5 second timeout
      
      // Define success listener
      const successListener = (updatedState: GameState) => {
        // Get the match ID from either the matchId property or fall back to the id property
        const stateMatchId = updatedState.matchId || updatedState.id;
        
        if (stateMatchId === matchId) {
          clearTimeout(timeout);
          this.socket?.off('gameStateUpdate', successListener);
          this.socket?.off('actionError', errorListener);
          resolve();
        }
      };
      
      // Define error listener
      const errorListener = (error: any) => {
        clearTimeout(timeout);
        this.socket?.off('gameStateUpdate', successListener);
        this.socket?.off('actionError', errorListener);
        
        // Pass along the error code if it exists
        if (error.code) {
          const customError = new Error(error.message || 'Unknown error');
          (customError as any).code = error.code;
          reject(customError);
        } else {
          reject(new Error(error.message || 'Unknown error'));
        }
      };
      
      // Listen for success and error events
      this.socket?.on('gameStateUpdate', successListener);
      this.socket?.on('actionError', errorListener);
      
      // Emit the action
      this.socket?.emit('gameAction', actionWithMatchId, (error: any) => {
        if (error) {
          clearTimeout(timeout);
          this.socket?.off('gameStateUpdate', successListener);
          this.socket?.off('actionError', errorListener);
          
          // Pass along the error code if it exists
          if (error.code) {
            const customError = new Error(error.message || 'Unknown error');
            (customError as any).code = error.code;
            reject(customError);
          } else {
            reject(new Error(error.message || 'Unknown error'));
          }
        }
      });
    });
  }
  
  /**
   * Registers a callback for game state updates
   */
  onGameStateUpdate(callback: (state: GameState) => void): void {
    if (!this.socket) {
      console.log("Cannot set up gameStateUpdate listener - socket is null");
      return;
    }
    
    // Remove any existing listeners to avoid duplicates
    this.socket.off('gameStateUpdate');
    
    this.socket.on('gameStateUpdate', (state: GameState) => {
      // Get the match ID from either the matchId property or fall back to the id property
      const stateMatchId = state.matchId || state.id;
      
      // Only process updates for the current match
      if (stateMatchId === this.currentMatchId) {
        console.log('Received game state update for current match');
        
        // Call the callback with the updated state
        callback(state);
      }
    });
  }
  
  /**
   * Registers a callback for match updates
   */
  onMatchUpdate(callback: (match: Match) => void): void {
    if (!this.socket) return;
    
    this.socket.on('matchUpdated', callback);
  }
  
  /**
   * Registers a callback for match removal events
   */
  onMatchRemoved(callback: (matchId: string) => void): void {
    if (!this.socket) return;
    
    this.socket.on('matchRemoved', callback);
  }
  
  /**
   * Registers a callback for battle start events
   */
  onBattleStart(callback: (battleState: BattleState) => void): void {
    if (!this.socket) return;
    
    this.socket.on('battleStart', callback);
  }
  
  /**
   * Registers a callback for battle update events
   */
  onBattleUpdate(callback: (battleState: BattleState) => void): void {
    if (!this.socket) return;
    
    this.socket.on('battleUpdate', callback);
  }
  
  /**
   * Registers a callback for battle end events
   */
  onBattleEnd(callback: (winner: Unit | null) => void): void {
    if (!this.socket) return;
    
    this.socket.on('battleEnd', callback);
  }

  /**
   * Sends a request to exit the current match
   */
  async exitMatch(matchId: string, playerId: string): Promise<void> {
    try {
      const response = await fetch(`http://localhost:4000/api/game/${matchId}/exit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ playerId }),
      });

      if (!response.ok) {
        throw new Error('Failed to exit match');
      }
    } catch (error) {
      console.error('Error exiting match:', error);
      throw error;
    }
  }
}

export default NetworkManager; 