import { useState, useEffect, useRef } from 'react';
import { 
  GameState, 
  Position, 
  Unit, 
  GameAction,
  UnitType,
  BattleState
} from '@archess/shared';
import { GameActionType } from '../types/game';
import NetworkManager from '../services/NetworkManager';
import ArcadeCombatManager from '../services/ArcadeCombatManager';
import ArcadeCombat from './arcade/ArcadeCombat';
import './GameBoard.css';
import React from 'react';

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
  const [activeBattle, setActiveBattle] = useState<BattleState | null>(null);
  
  // Get a reference to the combat manager
  const arcadeCombatManager = ArcadeCombatManager.getInstance();
  
  // Update board units when the gameState changes
  useEffect(() => {
    if (gameState) {
      setBoardUnits(gameState.board.units);
      
      // Clear error message when game state updates
      setErrorMessage(null);
    }
  }, [gameState]);
  
  // Listen for battle state changes
  useEffect(() => {
    const handleBattleChange = (battleState: BattleState | null) => {
      console.log('Battle state changed:', battleState);
      
      // Validate the battle state before setting it
      if (battleState) {
        console.log('Validating battle state before activating', {
          attackerExists: !!battleState.attacker,
          defenderExists: !!battleState.defender,
          attackerId: battleState.attacker?.id,
          defenderId: battleState.defender?.id
        });
        
        const isValid = 
          battleState.attacker && 
          battleState.defender && 
          typeof battleState.attacker.id === 'string' &&
          typeof battleState.defender.id === 'string';
        
        if (!isValid) {
          console.error('Received invalid battle state:', battleState);
          return;
        }
        
        // Additional validation to ensure units have stats
        if (!battleState.attacker.stats || !battleState.defender.stats) {
          console.error('Battle units missing stats:', battleState);
          return;
        }
        
        console.log('Battle state valid, activating battle');
      } else {
        console.log('Clearing battle state');
      }
      
      setActiveBattle(battleState);
    };
    
    console.log('Setting up battle listener');
    // Register listener with the combat manager
    arcadeCombatManager.addBattleListener(handleBattleChange);
    
    return () => {
      console.log('Cleaning up battle listener');
      arcadeCombatManager.removeBattleListener(handleBattleChange);
    };
  }, [arcadeCombatManager]);
  
  // Listen for game state changes that might indicate a battle
  useEffect(() => {
    // If there are units from different players on the same position, it might be a battle
    if (gameState && gameState.board && gameState.board.units) {
      const positionMap: { [key: string]: Unit[] } = {};
      
      // Group units by position
      gameState.board.units.forEach(unit => {
        if (!unit || !unit.position) return;
        
        const posKey = `${unit.position.x},${unit.position.y}`;
        if (!positionMap[posKey]) {
          positionMap[posKey] = [];
        }
        positionMap[posKey].push(unit);
      });
      
      // Check for positions with multiple units from different players
      for (const posKey in positionMap) {
        const unitsAtPos = positionMap[posKey];
        if (unitsAtPos.length > 1) {
          const owners = new Set(unitsAtPos.map(u => u.owner));
          if (owners.size > 1) {
            console.log('Detected potential battle in game state update:', unitsAtPos);
            
            // Ensure we're not already in a battle
            if (!activeBattle) {
              // Try to initialize battle through the manager
              const unitA = unitsAtPos[0];
              const unitB = unitsAtPos[1];
              if (unitA.owner !== unitB.owner) {
                arcadeCombatManager.checkForBattle(gameState, unitA);
              }
            }
          }
        }
      }
    }
  }, [gameState, activeBattle, arcadeCombatManager]);
  
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
      
      console.log('Move completed, checking for battles with:', {
        unitId: unit.id,
        targetPosition
      });
      
      // Create a clone of the unit with the updated position for battle checking
      const updatedUnit = {
        ...unit,
        position: targetPosition
      };
      
      // Check if there are any enemy units at the target position
      const enemyUnitsAtPosition = gameState.board.units.filter(u => 
        u.id !== unit.id && // Not the moved unit
        u.owner !== currentPlayer && // Enemy unit
        u.position.x === targetPosition.x && 
        u.position.y === targetPosition.y
      );
      
      console.log('Enemy units at target position:', enemyUnitsAtPosition);
      
      if (enemyUnitsAtPosition.length > 0) {
        console.log('Potential battle detected with unit:', enemyUnitsAtPosition[0]);
        
        // Create a wait promise to ensure both players have time to sync
        const waitForBattleSync = new Promise<void>((resolve) => {
          // First create a modified game state with the updated unit position
          const modifiedGameState = {
            ...gameState,
            board: {
              ...gameState.board,
              units: gameState.board.units.map(u => 
                u.id === unit.id ? updatedUnit : u
              )
            }
          };
          
          // Battle with the first enemy unit we find
          const battle = arcadeCombatManager.checkForBattle(modifiedGameState, updatedUnit);
          
          if (battle) {
            console.log('Battle confirmed and activated!');
            // A battle was triggered, so we'll wait for the battle to complete
            // The turn will be ended after the battle is over
            resolve();
            return;
          }
          
          // No battle was triggered, proceed after a short delay
          setTimeout(() => {
            console.warn('Battle check did not create a battle despite enemy units at position');
            resolve();
          }, 300);
        });
        
        // Wait for battle sync before proceeding
        await waitForBattleSync;
        
        // If a battle was triggered (activeBattle is set), return without ending turn
        if (activeBattle) {
          return;
        }
      } else {
        console.log('No enemy units at target position, continuing turn end');
      }
      
      // No battle was triggered, proceed with ending the turn
      await endTurn();
      
      // Clear selection after ending turn
      setSelectedUnit(null);
      setPossibleMoves([]);
      
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
      throw error; // Rethrow to let calling code handle it
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
  
  // Handle battle completion with better error handling
  const handleBattleComplete = async (winnerUnit: Unit) => {
    console.log('Battle completed in GameBoard, winner:', winnerUnit);
    
    // Make a local copy of the winner to avoid reference issues
    const winner = { ...winnerUnit };
    
    try {
      // Update the game state based on battle outcome
      console.log('Notifying battle manager of completion');
      arcadeCombatManager.completeBattle(winner);
      
      console.log('Waiting briefly before ending turn');
      // Wait a short time to ensure both clients have processed the battle result
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('Ending turn after battle completion');
      // End the turn after the battle is over, with more robust error handling
      try {
        await endTurn();
      } catch (endTurnError) {
        console.error('Error ending turn after battle:', endTurnError);
        // If we can't end the turn through the normal flow, don't try to force it
        // Just clear the battle state and let the game continue
        console.log('Could not end turn normally, clearing battle state');
      }
      
      // Clear selection and battle state regardless of whether endTurn succeeded
      setSelectedUnit(null);
      setPossibleMoves([]);
      setActiveBattle(null);
    } catch (error) {
      console.error('Error completing battle:', error);
      
      // Clear battle state and selection to ensure game can continue
      arcadeCombatManager.completeBattle(winner);
      setActiveBattle(null);
      setSelectedUnit(null);
      setPossibleMoves([]);
    }
  };
  
  // Render the arcade combat overlay if there's an active battle
  const renderArcadeCombat = () => {
    if (!activeBattle) {
      return null;
    }

    console.log('Rendering arcade combat with battle state:', {
      id: activeBattle.id,
      attackerOwner: activeBattle.attacker?.owner,
      defenderOwner: activeBattle.defender?.owner,
      attackerPos: activeBattle.attacker?.position,
      defenderPos: activeBattle.defender?.position
    });

    // Validate battle state has required properties
    const isValidBattle = 
      activeBattle && 
      activeBattle.attacker && 
      activeBattle.defender && 
      typeof activeBattle.attacker.id === 'string' &&
      typeof activeBattle.defender.id === 'string' &&
      activeBattle.attacker.stats &&
      activeBattle.defender.stats;
    
    if (!isValidBattle) {
      console.error('Invalid battle state detected:', activeBattle);
      // Auto-end the invalid battle
      setTimeout(() => {
        try {
          // Use the first valid unit as winner, or create a default winner
          const winner = 
            (activeBattle.attacker && typeof activeBattle.attacker.id === 'string') ? activeBattle.attacker :
            (activeBattle.defender && typeof activeBattle.defender.id === 'string') ? activeBattle.defender :
            {
              id: 'default-winner',
              type: 'CHAMPION' as UnitType,
              position: { x: 0, y: 0 },
              owner: currentPlayer || 'player1',
              stats: { health: 100, maxHealth: 100, speed: 5, attack: 10, defense: 5 }
            };
          
          arcadeCombatManager.completeBattle(winner);
          endTurn().catch(e => console.error('Error ending turn after invalid battle:', e));
        } catch (error) {
          console.error('Error handling invalid battle state:', error);
        }
      }, 0);
      
      // Show error fallback
      return (
        <div className="arcade-error-container">
          <div className="arcade-error-message">
            There was an error with the combat. The turn will continue.
          </div>
          <button
            onClick={() => {
              arcadeCombatManager.completeBattle({
                id: 'default-winner',
                type: 'CHAMPION' as UnitType,
                position: { x: 0, y: 0 },
                owner: currentPlayer || 'player1',
                stats: { health: 100, maxHealth: 100, speed: 5, attack: 10, defense: 5 }
              });
              endTurn().catch(e => console.error('Error ending turn:', e));
              setActiveBattle(null);
            }}
            className="arcade-error-button"
          >
            Continue
          </button>
        </div>
      );
    }
    
    // Battle state is valid, render the combat component with error fallback
    return (
      <ErrorFallback 
        fallback={
          <div className="arcade-error-container">
            <div className="arcade-error-message">
              There was an error during combat. The turn will continue.
            </div>
            <button
              onClick={() => {
                // Clear battle state and try to end turn
                arcadeCombatManager.completeBattle(activeBattle.attacker);
                endTurn().catch(e => console.error('Error ending turn:', e));
                setActiveBattle(null);
              }}
              className="arcade-error-button"
            >
              Continue
            </button>
          </div>
        }
      >
        <ArcadeCombat 
          battleState={activeBattle}
          onBattleComplete={handleBattleComplete}
          currentPlayer={currentPlayer || ''}
        />
      </ErrorFallback>
    );
  };
  
  return (
    <div className="game-board-container">
      {errorMessage && (
        <div className="game-error-message">{errorMessage}</div>
      )}
      
      {/* Debug information */}
      {process.env.NODE_ENV !== 'production' && (
        <div style={{ position: 'fixed', top: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.7)', color: 'white', padding: '5px', fontSize: '12px', maxWidth: '300px', zIndex: 1000 }}>
          <div>Active Battle: {activeBattle ? 'Yes' : 'No'}</div>
          <div>Current Player: {currentPlayer}</div>
          <div>Current Turn: {getCurrentTurnPlayerId()}</div>
          <div>Selected Unit: {selectedUnit ? selectedUnit.type : 'None'}</div>
          <div>Processing: {isProcessingAction ? 'Yes' : 'No'}</div>
        </div>
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
        {/* End turn button removed as per requirements */}
        {isPlayersTurn() && isMatchReady() && (
          <div className="turn-instructions">
            Move a unit to automatically end your turn
          </div>
        )}
      </div>
      
      {/* Use the renderArcadeCombat function */}
      {renderArcadeCombat()}
    </div>
  );
};

// Simple error boundary wrapper component
const ErrorFallback = ({ 
  children, 
  fallback 
}: { 
  children: React.ReactNode, 
  fallback: React.ReactNode 
}) => {
  const [hasError, setHasError] = useState(false);
  const [errorDetails, setErrorDetails] = useState<any>(null);
  const errorHandledRef = useRef(false);
  
  // Reset error state when children change
  useEffect(() => {
    setHasError(false);
    setErrorDetails(null);
    errorHandledRef.current = false;
  }, [children]);
  
  useEffect(() => {
    const errorHandler = (event: ErrorEvent | Event) => {
      // Avoid handling the same error multiple times
      if (errorHandledRef.current) return true;
      
      // Extract error details
      const error = event instanceof ErrorEvent ? event.error : 
                    (event as any).reason || new Error('Unknown error');
      
      console.log('Error caught by ErrorFallback:', error);
      
      // Update state
      setHasError(true);
      setErrorDetails(error);
      errorHandledRef.current = true;
      
      // Prevent the default error handling
      if (event.preventDefault) {
        event.preventDefault();
      }
      if (event.stopPropagation) {
        event.stopPropagation();
      }
      
      return true;
    };
    
    // More specific type handling
    const errorEventHandler = (event: ErrorEvent) => errorHandler(event);
    const rejectionHandler = (event: PromiseRejectionEvent) => errorHandler(event);
    
    // Listen for both error and unhandledrejection events
    window.addEventListener('error', errorEventHandler, true);
    window.addEventListener('unhandledrejection', rejectionHandler, true);
    
    return () => {
      window.removeEventListener('error', errorEventHandler, true);
      window.removeEventListener('unhandledrejection', rejectionHandler, true);
    };
  }, []);
  
  // If error info is available, you can log specific details
  useEffect(() => {
    if (errorDetails) {
      console.error('Error details:', errorDetails);
    }
  }, [errorDetails]);
  
  // React's error boundary component equivalent
  if (hasError) {
    console.log('Rendering fallback due to caught error');
    return <React.Fragment>{fallback}</React.Fragment>;
  }
  
  // No error, render children
  return <React.Fragment>{children}</React.Fragment>;
};

export default GameBoard; 