export type Position = {
  x: number;
  y: number;
};

export type Player = {
  id: string;
  name: string;
  color: string;
};

export type Unit = {
  id: string;
  type: UnitType;
  owner: string;
  position: Position;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
};

export enum UnitType {
  WARRIOR = 'WARRIOR',
  ARCHER = 'ARCHER',
  MAGE = 'MAGE'
}

export enum TileType {
  EMPTY = 'EMPTY',
  WALL = 'WALL',
  WATER = 'WATER'
}

export enum GamePhase {
  TURN_BASED = 'TURN_BASED',
  BATTLE = 'BATTLE'
}

export enum GameActionType {
  MOVE = 'MOVE',
  END_TURN = 'END_TURN'
}

export type GameAction = {
  type: GameActionType;
  playerId: string;
  unitId: string;
  targetPosition?: Position;
  timestamp: number;
};

export type GameState = {
  id: string;
  matchId?: string;
  players: Player[];
  currentTurn: string;
  phase: GamePhase;
  board: {
    width: number;
    height: number;
    tiles: TileType[][];
    units: Unit[];
  };
};

export interface IGameManager {
  initializeGame(matchId: string): Promise<GameState>;
  handleAction(action: GameAction & { matchId: string }): Promise<GameState>;
  validateAction(action: GameAction, gameState: GameState): boolean;
  getGameState(matchId: string): GameState | undefined;
}

// ... rest of existing types ... 