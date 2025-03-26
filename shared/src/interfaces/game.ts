import { 
  GameState, 
  GameAction, 
  Position, 
  Unit, 
  BattleState,
  TileType,
  UnitType,
  PlayerId,
  UnitStats
} from '../types/game';

export interface IGameManager {
  initializeGame(): Promise<GameState>;
  handleAction(action: GameAction): Promise<GameState>;
  validateAction(action: GameAction): boolean;
  getGameState(): GameState;
}

export interface IBoardManager {
  isValidMove(unit: Unit, targetPosition: Position): boolean;
  getUnitsInRange(position: Position, range: number): Unit[];
  getTileAt(position: Position): TileType;
  moveUnit(unit: Unit, targetPosition: Position): void;
}

export interface IBattleManager {
  initializeBattle(attacker: Unit, defender: Unit): BattleState;
  updateBattle(battleState: BattleState, deltaTime: number): BattleState;
  isBattleComplete(battleState: BattleState): boolean;
  getBattleWinner(battleState: BattleState): Unit | null;
}

export interface IUnitManager {
  createUnit(type: UnitType, owner: PlayerId, position: Position): Unit;
  updateUnitStats(unit: Unit, deltaStats: Partial<UnitStats>): Unit;
  applyDamage(unit: Unit, damage: number): Unit;
  healUnit(unit: Unit, amount: number): Unit;
}

export interface INetworkManager {
  connect(): Promise<void>;
  disconnect(): void;
  sendAction(action: GameAction): Promise<void>;
  getPlayerId(): string | null;
  getSocket(): any; // Using 'any' here to avoid importing Socket from socket.io-client in the shared code
  onGameStateUpdate(callback: (state: GameState) => void): void;
  onBattleStart(callback: (battleState: BattleState) => void): void;
  onBattleUpdate(callback: (battleState: BattleState) => void): void;
  onBattleEnd(callback: (winner: Unit | null) => void): void;
} 