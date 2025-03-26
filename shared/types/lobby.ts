export type PlayerRole = 'player1' | 'player2';

export type MatchStatus = 'waiting' | 'in_progress' | 'completed';

export interface Match {
  id: string;
  player1?: string;  // Player ID/name who joined as player1
  player2?: string;  // Player ID/name who joined as player2
  status: MatchStatus;
  createdAt: number;  // Unix timestamp
}

export interface CreateMatchResponse {
  match: Match;
}

export interface JoinMatchRequest {
  matchId: string;
  role: PlayerRole;
  playerName: string;  // For displaying in the lobby
}

export interface JoinMatchResponse {
  success: boolean;
  match?: Match;
  error?: string;
}

export interface ListMatchesResponse {
  matches: Match[];
} 