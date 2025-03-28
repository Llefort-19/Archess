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

// Constants for the game board
const BOARD_WIDTH = 5;
const BOARD_HEIGHT = 5;

// Movement limits for each unit type
const MOVEMENT_LIMITS = {
  'CHAMPION': 1,   // Champion moves 1 tile per turn
  'SCOUT': 3,      // Scout moves up to 3 tiles per turn
  'DEFENDER': 1,   // Defender moves 1 tile per turn
  'MAGE': 2        // Mage moves up to 2 tiles per turn
};

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
    // Check if both players are present in the game (match is complete)
    if (action.playerId === 'player1' && gameState.players.length < 2) {
      return false; // Player 1 cannot make moves until Player 2 has joined
    }
    
    // Basic validation
    if (action.playerId !== gameState.currentTurnPlayerId) {
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
    
    // Get the movement limit for this unit type
    const movementLimit = MOVEMENT_LIMITS[unit.type as keyof typeof MOVEMENT_LIMITS];
    
    // Calculate the Manhattan distance (no diagonals allowed)
    const xDiff = Math.abs(targetPosition.x - unit.position.x);
    const yDiff = Math.abs(targetPosition.y - unit.position.y);
    
    // For simplified movement, we're not allowing diagonal movement
    // So the move is either horizontal or vertical, not both
    if (xDiff > 0 && yDiff > 0) {
      return false; // Diagonal movement is not allowed
    }
    
    const distance = xDiff + yDiff;
    
    // Check if the move distance is within the unit's movement limit
    if (distance > movementLimit) {
      return false;
    }
    
    // Check for path obstruction (units in the way)
    if (distance > 1) {
      // We need to check each tile in the path
      const dx = Math.sign(targetPosition.x - unit.position.x);
      const dy = Math.sign(targetPosition.y - unit.position.y);
      
      let currentX = unit.position.x;
      let currentY = unit.position.y;
      
      // Check each tile along the path (excluding the start and target)
      while ((currentX !== targetPosition.x) || (currentY !== targetPosition.y)) {
        currentX += dx;
        currentY += dy;
        
        // Skip checking the target position (we want to allow moving to an enemy-occupied tile)
        if (currentX === targetPosition.x && currentY === targetPosition.y) {
          break;
        }
        
        // Check if there's any unit blocking the path
        const blockingUnit = gameState.board.units.find(u => 
          u.position.x === currentX && u.position.y === currentY
        );
        
        if (blockingUnit) {
          return false; // Path is blocked
        }
      }
    }
    
    // Check if there is another friendly unit at the target position
    const unitAtTarget = gameState.board.units.find(u => 
      u.position.x === targetPosition.x && 
      u.position.y === targetPosition.y && 
      u.owner === unit.owner
    );
    
    if (unitAtTarget) {
      return false; // Cannot move to a position occupied by a friendly unit
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
    
    let updatedUnits = [...gameState.board.units];
    
    if (enemyUnitIndex !== -1) {
      // For this prototype, we'll merely register the board position, 
      // but in the future, this would trigger the arcade combat phase
      
      // Move the attacking unit to the target position
      updatedUnits[unitIndex] = {
        ...unit,
        position: action.targetPosition
      };
      
      // Note: In the actual game, instead of removing the enemy unit here,
      // we would trigger the arcade combat phase and determine the outcome there.
      // For now, we'll just simulate a battle by removing the enemy unit
      updatedUnits.splice(enemyUnitIndex, 1);
    } else {
      // Just move the unit
      updatedUnits[unitIndex] = {
        ...unit,
        position: action.targetPosition
      };
    }
    
    // Update the game state
    return {
      ...gameState,
      board: {
        ...gameState.board,
        units: updatedUnits
      }
    };
  }
  
  private handleEndTurnAction(action: GameAction, gameState: GameState): GameState {
    // Switch to the other player's turn
    const currentPlayerIndex = gameState.players.findIndex(p => p.id === gameState.currentTurnPlayerId);
    const nextPlayerIndex = (currentPlayerIndex + 1) % gameState.players.length;
    
    return {
      ...gameState,
      currentTurnPlayerId: gameState.players[nextPlayerIndex].id
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
    
    // Create a 5x5 board as specified in requirements
    const width = BOARD_WIDTH;
    const height = BOARD_HEIGHT;
    
    // Initialize all tiles as empty
    const tiles: TileType[][] = Array(height).fill(null).map(() => 
      Array(width).fill(TileType.EMPTY)
    );
    
    // Create units for each player
    const units: Unit[] = [
      // Player 1 units
      {
        id: uuidv4(),
        type: 'CHAMPION' as UnitType,
        position: { x: 0, y: 0 },
        owner: player1.id,
        health: 100,
        maxHealth: 100,
        attack: 10,
        defense: 5,
        speed: 1
      },
      {
        id: uuidv4(),
        type: 'SCOUT' as UnitType,
        position: { x: 1, y: 0 },
        owner: player1.id,
        health: 60,
        maxHealth: 60,
        attack: 7,
        defense: 3,
        speed: 3
      },
      {
        id: uuidv4(),
        type: 'DEFENDER' as UnitType,
        position: { x: 2, y: 0 },
        owner: player1.id,
        health: 80,
        maxHealth: 80,
        attack: 6,
        defense: 9,
        speed: 1
      },
      {
        id: uuidv4(),
        type: 'MAGE' as UnitType,
        position: { x: 3, y: 0 },
        owner: player1.id,
        health: 70,
        maxHealth: 70,
        attack: 12,
        defense: 4,
        speed: 2
      },
      
      // Player 2 units
      {
        id: uuidv4(),
        type: 'CHAMPION' as UnitType,
        position: { x: 4, y: 4 },
        owner: player2.id,
        health: 100,
        maxHealth: 100,
        attack: 10,
        defense: 5,
        speed: 1
      },
      {
        id: uuidv4(),
        type: 'SCOUT' as UnitType,
        position: { x: 3, y: 4 },
        owner: player2.id,
        health: 60,
        maxHealth: 60,
        attack: 7,
        defense: 3,
        speed: 3
      },
      {
        id: uuidv4(),
        type: 'DEFENDER' as UnitType,
        position: { x: 2, y: 4 },
        owner: player2.id,
        health: 80,
        maxHealth: 80,
        attack: 6,
        defense: 9,
        speed: 1
      },
      {
        id: uuidv4(),
        type: 'MAGE' as UnitType,
        position: { x: 1, y: 4 },
        owner: player2.id,
        health: 70,
        maxHealth: 70,
        attack: 12,
        defense: 4,
        speed: 2
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
      currentTurnPlayerId: player1.id,
      phase: GamePhase.TURN_BASED,
      players: [player1, player2]
    };
  }
} 