import { 
  IGameManager,
  GameState, 
  GameAction, 
  Unit, 
  TileType, 
  UnitType, 
  GamePhase,
  GameActionType,
  Position,
  Player
} from '@archess/shared';
import { v4 as uuidv4 } from 'uuid';

export class GameManager implements IGameManager {
  private gameStates: Map<string, GameState>;
  
  constructor() {
    this.gameStates = new Map();
  }
  
  async initializeGame(matchId: string): Promise<GameState> {
    const gameState = this.createInitialGameState();
    // Store the game state with the matchId
    const gameStateWithMatchId = {
      ...gameState,
      matchId
    };
    this.gameStates.set(matchId, gameStateWithMatchId);
    return gameStateWithMatchId;
  }
  
  async handleAction(action: GameAction & { matchId: string }): Promise<GameState> {
    const gameState = this.gameStates.get(action.matchId);
    if (!gameState) {
      throw new Error('Match not found');
    }

    if (!this.validateAction(action, gameState)) {
      throw new Error('Invalid action');
    }
    
    let updatedState: GameState;
    switch (action.type) {
      case GameActionType.MOVE:
        updatedState = this.handleMoveAction(action, gameState);
        break;
      case GameActionType.END_TURN:
        updatedState = this.handleEndTurnAction(action, gameState);
        break;
      default:
        throw new Error(`Action type ${action.type} not implemented`);
    }

    // Ensure the matchId is preserved
    updatedState.matchId = action.matchId;

    // Update the stored game state
    this.gameStates.set(action.matchId, updatedState);
    return updatedState;
  }
  
  validateAction(action: GameAction, gameState: GameState): boolean {
    // Basic validation
    if (action.playerId !== gameState.currentTurn) {
      return false;
    }
    
    if (gameState.phase !== GamePhase.TURN_BASED) {
      return false;
    }
    
    // Special case for END_TURN which doesn't need a unit
    if (action.type === GameActionType.END_TURN) {
      return true;
    }
    
    const unit = gameState.board.units.find(u => u.id === action.unitId);
    
    if (!unit) {
      return false;
    }
    
    if (unit.owner !== action.playerId) {
      return false;
    }
    
    if (action.type === GameActionType.MOVE && !action.targetPosition) {
      return false;
    }
    
    if (action.type === GameActionType.MOVE && action.targetPosition) {
      return this.isValidMove(unit, action.targetPosition, gameState);
    }
    
    return true;
  }
  
  getGameState(matchId: string): GameState | undefined {
    const gameState = this.gameStates.get(matchId);
    if (gameState) {
      // Ensure the matchId is included in the game state
      return {
        ...gameState,
        matchId
      };
    }
    return undefined;
  }
  
  private isValidMove(unit: Unit, targetPosition: Position, gameState: GameState): boolean {
    // Check if trying to move to current position
    if (unit.position.x === targetPosition.x && unit.position.y === targetPosition.y) {
      return false;
    }
    
    // Check if position is within board boundaries
    if (
      targetPosition.x < 0 || 
      targetPosition.x >= gameState.board.width ||
      targetPosition.y < 0 || 
      targetPosition.y >= gameState.board.height
    ) {
      return false;
    }
    
    // Check if the tile is a wall
    if (gameState.board.tiles[targetPosition.y][targetPosition.x] === TileType.WALL) {
      return false;
    }
    
    // For this simplified version, only allow 1 square movement (like chess)
    const xDiff = Math.abs(targetPosition.x - unit.position.x);
    const yDiff = Math.abs(targetPosition.y - unit.position.y);
    
    // Allow movement of only 1 square in any direction
    if (xDiff > 1 || yDiff > 1) {
      return false;
    }
    
    // Check if there is another friendly unit at the target position
    const unitAtTarget = gameState.board.units.find(u => 
      u.position.x === targetPosition.x && 
      u.position.y === targetPosition.y && 
      u.owner === unit.owner
    );
    
    if (unitAtTarget) {
      return false;
    }
    
    return true;
  }
  
  private handleMoveAction(action: GameAction, gameState: GameState): GameState {
    if (!action.targetPosition) {
      throw new Error('Target position is required for move action');
    }
    
    const unitIndex = gameState.board.units.findIndex(u => u.id === action.unitId);
    const unit = gameState.board.units[unitIndex];
    
    // Check if there's an enemy unit at the target position
    const enemyUnitIndex = gameState.board.units.findIndex(u => 
      u.position.x === action.targetPosition!.x && 
      u.position.y === action.targetPosition!.y && 
      u.owner !== unit.owner
    );
    
    if (enemyUnitIndex !== -1) {
      // In a real implementation, this would start a battle
      // For now, we'll just remove the enemy unit (simulating a won battle)
      const enemyUnit = gameState.board.units[enemyUnitIndex];
      
      // Create a copy of the units array and remove the enemy unit
      const updatedUnits = [...gameState.board.units];
      updatedUnits.splice(enemyUnitIndex, 1);
      
      // Move the attacking unit to the target position
      updatedUnits[unitIndex] = {
        ...unit,
        position: action.targetPosition
      };
      
      // Update the game state
      return {
        ...gameState,
        board: {
          ...gameState.board,
          units: updatedUnits
        }
      };
    } else {
      // Just move the unit
      const updatedUnits = [...gameState.board.units];
      updatedUnits[unitIndex] = {
        ...unit,
        position: action.targetPosition
      };
      
      // Update the game state
      return {
        ...gameState,
        board: {
          ...gameState.board,
          units: updatedUnits
        }
      };
    }
  }
  
  private handleEndTurnAction(action: GameAction, gameState: GameState): GameState {
    // Switch to the other player's turn
    const currentPlayerIndex = gameState.players.findIndex(p => p.id === gameState.currentTurn);
    const nextPlayerIndex = (currentPlayerIndex + 1) % gameState.players.length;
    
    return {
      ...gameState,
      currentTurn: gameState.players[nextPlayerIndex].id
    };
  }
  
  private createInitialGameState(): GameState {
    // Create two players
    const player1: Player = {
      id: 'player1',
      name: 'Player 1',
      color: '#3498db' // blue
    };
    
    const player2: Player = {
      id: 'player2',
      name: 'Player 2',
      color: '#e74c3c' // red
    };
    
    // Create a small 3x3 board
    const width = 3;
    const height = 3;
    
    // Initialize all tiles as empty
    const tiles: TileType[][] = Array(height).fill(null).map(() => 
      Array(width).fill(TileType.EMPTY)
    );
    
    // Create some units for each player
    const units: Unit[] = [
      // Player 1 units
      {
        id: uuidv4(),
        type: UnitType.WARRIOR,
        position: { x: 0, y: 0 },
        owner: player1.id,
        stats: {
          health: 100,
          maxHealth: 100,
          speed: 3,
          attack: 10,
          defense: 5
        }
      },
      
      // Player 2 units
      {
        id: uuidv4(),
        type: UnitType.WIZARD,
        position: { x: 2, y: 2 },
        owner: player2.id,
        stats: {
          health: 80,
          maxHealth: 80,
          speed: 2,
          attack: 15,
          defense: 3
        }
      }
    ];
    
    return {
      id: uuidv4(),
      board: {
        width,
        height,
        tiles,
        units
      },
      currentTurn: player1.id,
      phase: GamePhase.TURN_BASED,
      players: [player1, player2]
    };
  }
} 