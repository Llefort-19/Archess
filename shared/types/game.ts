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
  speed: number; // Movement speed of the unit
};

export enum UnitType {
  CHAMPION = 'CHAMPION',   // Strong unit with high HP and powerful melee attack
  SCOUT = 'SCOUT',         // Weak unit with fast ranged attack
  DEFENDER = 'DEFENDER',   // Weak unit with strong defense
  MAGE = 'MAGE'            // Medium unit with ranged magical attacks
}

export enum SpecialSkill {
  POWER_STRIKE = 'POWER_STRIKE',    // Champion's special skill
  DASH = 'DASH',                    // Scout's special skill
  SHIELD_WALL = 'SHIELD_WALL',      // Defender's special skill
  AREA_BLAST = 'AREA_BLAST'         // Mage's special skill
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
  END_TURN = 'END_TURN',
  USE_SKILL = 'USE_SKILL'
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
  currentTurnPlayerId: string;  // Renamed from currentTurn to be more explicit
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