import { Match, PlayerRole, MatchStatus } from '../../../shared/types/lobby';
import { v4 as uuidv4 } from 'uuid';

export class LobbyManager {
  private matches: Map<string, Match>;

  constructor() {
    this.matches = new Map();
  }

  createMatch(playerName: string): Match {
    const matchId = uuidv4();
    console.log(`Creating new match with ID: ${matchId}`);
    
    const match: Match = {
      id: matchId,
      status: 'waiting',
      createdAt: Date.now(),
      player1: playerName  // Automatically assign creator as player1
    };

    this.matches.set(match.id, match);
    console.log(`Match created: ${JSON.stringify(match)}`);
    return match;
  }

  listMatches(): Match[] {
    return Array.from(this.matches.values())
      .filter(match => match.status !== 'completed')  // Only return non-completed matches
      .sort((a, b) => b.createdAt - a.createdAt); // Most recent first
  }

  listCompletedMatches(): Match[] {
    return Array.from(this.matches.values())
      .filter(match => match.status === 'completed')
      .sort((a, b) => b.createdAt - a.createdAt); // Most recent first
  }

  getMatch(id: string): Match | undefined {
    return this.matches.get(id);
  }

  joinMatch(matchId: string, role: PlayerRole, playerName: string): { success: boolean; match?: Match; error?: string } {
    const match = this.matches.get(matchId);
    
    if (!match) {
      return { success: false, error: 'Match not found' };
    }

    if (match.status !== 'waiting') {
      return { success: false, error: 'Match is not available for joining' };
    }

    // Check if the requested role is available
    if (role === 'player1' && match.player1) {
      return { success: false, error: 'Player 1 slot is already taken' };
    }
    if (role === 'player2' && match.player2) {
      return { success: false, error: 'Player 2 slot is already taken' };
    }

    // Update the match with the new player
    if (role === 'player1') {
      match.player1 = playerName;
    } else {
      match.player2 = playerName;
    }

    // If both players have joined, update the status
    if (match.player1 && match.player2) {
      match.status = 'in_progress';
    }

    this.matches.set(matchId, match);
    return { success: true, match };
  }

  // For testing and cleanup
  clearMatches(): void {
    this.matches.clear();
  }

  // Remove completed or abandoned matches
  cleanupOldMatches(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, match] of this.matches.entries()) {
      if (now - match.createdAt > maxAgeMs) {
        this.matches.delete(id);
      }
    }
  }

  /**
   * Handles a player exiting a match
   * @param matchId The ID of the match
   * @param playerId The ID of the player who is exiting
   * @returns The updated match or null if the match was removed
   */
  handlePlayerExit(matchId: string, playerId: string): Match | null {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    // If this is the only player, remove the match entirely
    if ((playerId === 'player1' && !match.player2) || (playerId === 'player2' && !match.player1)) {
      this.matches.delete(matchId);
      return null;
    }

    // If there's another player, mark the match as completed
    match.status = 'completed';
    
    // Mark the exiting player as lost and the other player as won
    if (playerId === 'player1') {
      match.player1 = `${match.player1} (Lost)`;
      if (match.player2) {
        match.player2 = `${match.player2} (Won)`;
      }
    } else {
      match.player2 = `${match.player2} (Lost)`;
      if (match.player1) {
        match.player1 = `${match.player1} (Won)`;
      }
    }

    this.matches.set(matchId, match);
    return match;
  }
} 