import { useState, useEffect } from 'react';
import { 
  GameState, 
  Position, 
  Unit, 
  GameAction,
  UnitType
} from '@archess/shared';
import { GameActionType } from '../types/game';
import NetworkManager from '../services/NetworkManager';
import './GameBoard.css';

interface GameBoardProps {
  gameState: GameState;
  networkManager: NetworkManager;
  currentPlayer: string | null;
  matchId: string | null;
}

const GameBoard = ({ gameState, networkManager, currentPlayer, matchId }: GameBoardProps) => {
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [possibleMoves, setPossibleMoves] = useState<Position[]>([]);
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const [boardUnits, setBoardUnits] = useState<Unit[]>(gameState.board.units);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Update board units when the gameState changes
  useEffect(() => {
    if (gameState) {
      setBoardUnits(gameState.board.units);
      
      // Clear error message when game state updates
      setErrorMessage(null);
    }
  }, [gameState]);
  
  // Add useEffect to listen for match updates
  useEffect(() => {
    const socket = (window as any).socket;
    
    if (socket) {
      // Listen for match updates to get player names
      const handleMatchUpdated = (updatedMatch: any) => {
        if (updatedMatch.id === matchId) {
          // Update the activeMatches global with this latest match data
          const currentMatches = (window as any).activeMatches || [];
          const matchIndex = currentMatches.findIndex((m: any) => m.id === matchId);
          
          if (matchIndex >= 0) {
            currentMatches[matchIndex] = updatedMatch;
          } else {
            currentMatches.push(updatedMatch);
          }
          
          (window as any).activeMatches = currentMatches;
          
          // Force a re-render
          setBoardUnits([...boardUnits]);
        }
      };
      
      socket.on('matchUpdated', handleMatchUpdated);
      
      return () => {
        socket.off('matchUpdated', handleMatchUpdated);
      };
    }
  }, [matchId, boardUnits]);
  
  // Helper to generate a unique cell key
  const getCellKey = (x: number, y: number) => `cell-${x}-${y}`;
  
  // Helper to find a unit at a position
  const getUnitAtPosition = (x: number, y: number): Unit | undefined => {
    return boardUnits.find(u => u.position.x === x && u.position.y === y);
  };
  
  // Calculate possible moves for a unit based on its type
  const calculatePossibleMoves = (unit: Unit): Position[] => {
    const { x, y } = unit.position;
    const possiblePositions: Position[] = [];
    
    // Get the movement limit for this unit type
    let movementLimit = 1; // Default
    
    // Cast unit.type to string to handle enum inconsistencies
    const unitType = unit.type as string;
    
    switch (unitType) {
      case 'CHAMPION':
        movementLimit = 1;
        break;
      case 'SCOUT':
        movementLimit = 3;
        break;
      case 'DEFENDER':
        movementLimit = 1;
        break;
      case 'MAGE':
        movementLimit = 2;
        break;
    }
    
    // Add positions in each cardinal direction (no diagonals)
    // We'll check up to the movement limit in each direction
    const directions = [
      { dx: 1, dy: 0 },  // right
      { dx: -1, dy: 0 }, // left
      { dx: 0, dy: 1 },  // down
      { dx: 0, dy: -1 }, // up
    ];
    
    for (const { dx, dy } of directions) {
      // Check each step in this direction up to the movement limit
      for (let step = 1; step <= movementLimit; step++) {
        const newX = x + (dx * step);
        const newY = y + (dy * step);
        
        // Check if position is within board boundaries
        if (
          newX >= 0 && 
          newX < gameState.board.width && 
          newY >= 0 && 
          newY < gameState.board.height
        ) {
          // Check if there's a unit at this position
          const unitAtPosition = getUnitAtPosition(newX, newY);
          
          if (unitAtPosition) {
            // If there's a friendly unit, we can't move here or beyond
            if (unitAtPosition.owner === unit.owner) {
              break;
            }
            
            // If there's an enemy unit, we can move here (to attack) but not beyond
            possiblePositions.push({ x: newX, y: newY });
            break;
          }
          
          // Empty space, we can move here
          possiblePositions.push({ x: newX, y: newY });
        } else {
          // Out of bounds, stop checking in this direction
          break;
        }
      }
    }
    
    return possiblePositions;
  };
  
  // Access the current turn property safely
  const getCurrentTurnPlayerId = () => {
    // Use type assertion to handle the property name difference
    return (gameState as any).currentTurnPlayerId || gameState.currentTurn;
  };

  // Check if it's the current player's turn
  const isPlayersTurn = (): boolean => {
    return currentPlayer === getCurrentTurnPlayerId();
  };
  
  // Helper to check if the match is ready for play (both players joined)
  const isMatchReady = (): boolean => {
    return gameState.players.length === 2;
  };
  
  // Handle unit selection
  const handleUnitClick = (unit: Unit) => {
    if (isProcessingAction) return;
    
    // Clear any previous error messages
    setErrorMessage(null);
    
    // Check if both players are present
    if (currentPlayer === 'player1' && !isMatchReady()) {
      setErrorMessage('Waiting for Player 2 to join...');
      return;
    }
    
    // Only allow selecting units if it's player's turn and the unit belongs to them
    if (!isPlayersTurn() || unit.owner !== currentPlayer) {
      return;
    }
    
    setSelectedUnit(unit);
    setPossibleMoves(calculatePossibleMoves(unit));
  };
  
  // Handle cell click
  const handleCellClick = async (x: number, y: number) => {
    // Clear any previous error messages
    setErrorMessage(null);
    
    // Check if both players are present
    if (currentPlayer === 'player1' && !isMatchReady()) {
      setErrorMessage('Waiting for Player 2 to join...');
      return;
    }
    
    // Handle click based on game phase and selected unit
    if (!gameState || !currentPlayer || !networkManager || !matchId) {
      console.error('Game state, player, network manager, or match ID not available');
      return;
    }

    if (getCurrentTurnPlayerId() !== currentPlayer) {
      // Not this player's turn
      return;
    }

    if (selectedUnit) {
      try {
        // Player has a unit selected - try to move it to the clicked cell
        await moveUnit(selectedUnit, { x, y });
        setSelectedUnit(null);
      } catch (error: any) {
        console.error('Failed to move unit:', error);
        // Display specific error for waiting for Player 2
        if (error.message && error.message.includes('Waiting for Player 2')) {
          setErrorMessage('Waiting for Player 2 to join...');
        } else {
          setErrorMessage(error.message || 'Failed to move unit');
        }
      }
    } else {
      // No unit selected - see if there's a unit at the clicked position
      const unitAtPosition = getUnitAtPosition(x, y);
      if (unitAtPosition && unitAtPosition.owner === currentPlayer) {
        setSelectedUnit(unitAtPosition);
      }
    }
  };
  
  const moveUnit = async (unit: Unit, targetPosition: Position) => {
    if (!currentPlayer || !networkManager || !matchId) {
      throw new Error('Not connected to a match');
    }

    try {
      setIsProcessingAction(true);
      
      // Create a move action
      const moveAction: GameAction = {
        type: GameActionType.MOVE,
        playerId: currentPlayer,
        unitId: unit.id,
        targetPosition,
        timestamp: Date.now()
      };

      // Send the action to the server
      await networkManager.sendAction(moveAction, matchId);
      
      // Clear error message on success
      setErrorMessage(null);
    } catch (error: any) {
      // Check for specific error code
      if (error.code === 'WAITING_FOR_PLAYER2') {
        throw new Error('Waiting for Player 2 to join');
      }
      throw new Error(`Failed to move unit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProcessingAction(false);
    }
  };
  
  const endTurn = async () => {
    if (!currentPlayer || !networkManager || !matchId) {
      throw new Error('Not connected to a match');
    }

    try {
      const endTurnAction: GameAction = {
        type: GameActionType.END_TURN,
        playerId: currentPlayer,
        unitId: '', // End turn doesn't need a unit ID
        timestamp: Date.now()
      };

      await networkManager.sendAction(endTurnAction, matchId);
    } catch (error) {
      console.error('Failed to end turn:', error);
    }
  };
  
  // Helper to determine cell CSS classes
  const getCellClasses = (x: number, y: number) => {
    const position = { x, y };
    const unit = getUnitAtPosition(x, y);
    
    const classes = ['cell'];
    
    // Highlight selected unit
    if (selectedUnit && selectedUnit.position.x === x && selectedUnit.position.y === y) {
      classes.push('selected');
    }
    
    // Highlight possible move
    if (
      possibleMoves.some((move) => move.x === x && move.y === y)
    ) {
      classes.push('possible-move');
      
      // If it's an enemy unit, mark it as attackable
      if (unit && unit.owner !== currentPlayer) {
        classes.push('attackable');
      }
    }
    
    return classes.join(' ');
  };
  
  // Helper to render a unit
  const renderUnit = (unit: Unit) => {
    const unitClasses = ['unit', `unit-${unit.type.toLowerCase()}`, `player-${unit.owner}`];
    
    // Add class if this unit belongs to the current player
    if (unit.owner === currentPlayer) {
      unitClasses.push('current-player-unit');
    }
    
    return (
      <div 
        className={unitClasses.join(' ')}
        onClick={() => handleUnitClick(unit)}
      >
        {unit.type.charAt(0)}
      </div>
    );
  };
  
  // End turn handler
  const handleEndTurn = async () => {
    if (isProcessingAction || !isPlayersTurn()) return;
    
    // Use the matchId prop directly
    if (!matchId) {
      console.error('No match ID provided in props');
      return;
    }
    
    console.log(`Attempting to end turn for player ${currentPlayer} in match ${matchId}`);
    
    try {
      setIsProcessingAction(true);
      
      // Ensure player identification is established
      if (!networkManager.getPlayerId()) {
        console.log(`Re-establishing player identification as ${currentPlayer} in match ${matchId}`);
        try {
          await networkManager.connect();
          await networkManager.setPlayerId(currentPlayer || '', matchId);
          console.log('Player identification re-established successfully');
        } catch (err) {
          console.error('Failed to re-establish player identification:', err);
          throw new Error('Failed to identify player');
        }
      }
      
      await endTurn();
      
      // Clear selection after ending turn
      setSelectedUnit(null);
      setPossibleMoves([]);
    } catch (error) {
      console.error('Failed to end turn:', error);
    } finally {
      setIsProcessingAction(false);
    }
  };
  
  // Helper function to get the player name based on player ID
  const getPlayerName = (playerId: string) => {
    // Debug: Log available match data
    console.log('Getting player name for:', playerId);
    console.log('Current matchId:', matchId);
    console.log('Active matches available:', (window as any).activeMatches);
    
    // Always fetch the latest match data from the global store
    const activeMatches = (window as any).activeMatches || [];
    const match = activeMatches.find((m: any) => m.id === matchId);
    
    if (match) {
      console.log('Found match:', match);
      // Get player name from match data if available (from lobby)
      if (playerId === 'player1' && match.player1) {
        return `${match.player1}`;
      } else if (playerId === 'player2' && match.player2) {
        return `${match.player2}`;
      }
    }
    
    // Find the player in the game state players array
    const playerInfo = gameState.players.find(p => p.id === playerId);
    
    // Fallback to game state player info
    if (playerInfo && playerInfo.name && playerInfo.name !== 'Player 1' && playerInfo.name !== 'Player 2') {
      return `${playerInfo.name}`;
    }
    
    // Default fallback
    return playerId === 'player1' ? 'Player 1' : 'Player 2';
  };

  // Get colors for player 1 and player 2
  const player1Color = '#3498db'; // Blue
  const player2Color = '#e74c3c'; // Red

  const isMyTurn = isPlayersTurn();
  
  return (
    <div className="game-board-container">
      {errorMessage && (
        <div className="game-error-message">{errorMessage}</div>
      )}
      
      <div className="players-status">
        <div className={`player-status player1 ${getCurrentTurnPlayerId() === 'player1' ? 'current-turn' : ''}`}>
          <div className="player-color-indicator" style={{ backgroundColor: player1Color }}></div>
          <span>{getPlayerName('player1')}</span>
          {getCurrentTurnPlayerId() === 'player1' && <span className="turn-mark">*</span>}
        </div>
        
        <div className="vs-indicator">VS</div>
        
        <div className={`player-status player2 ${getCurrentTurnPlayerId() === 'player2' ? 'current-turn' : ''}`}>
          <div className="player-color-indicator" style={{ backgroundColor: player2Color }}></div>
          <span>{getPlayerName('player2')}</span>
          {getCurrentTurnPlayerId() === 'player2' && <span className="turn-mark">*</span>}
        </div>
      </div>
      
      <div 
        className="game-board" 
        style={{
          gridTemplateColumns: `repeat(${gameState.board.width}, 1fr)`,
          gridTemplateRows: `repeat(${gameState.board.height}, 1fr)`
        }}
      >
        {Array.from({ length: gameState.board.height }).map((_, y) =>
          Array.from({ length: gameState.board.width }).map((_, x) => {
            const unit = getUnitAtPosition(x, y);
            return (
              <div
                key={getCellKey(x, y)}
                className={getCellClasses(x, y)}
                onClick={() => handleCellClick(x, y)}
              >
                {unit && renderUnit(unit)}
              </div>
            );
          })
        )}
      </div>
      
      <div className="game-controls">
        <button
          className="end-turn-button"
          onClick={handleEndTurn}
          disabled={!isPlayersTurn() || !isMatchReady() || isProcessingAction}
        >
          End Turn
        </button>
      </div>
    </div>
  );
};

export default GameBoard; 