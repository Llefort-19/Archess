import React, { useState, useEffect, useRef, useReducer, useCallback, useMemo, memo } from 'react';
import { Unit, BattleState, GameState, Position, UnitType } from '@archess/shared';
import './ArcadeCombat.css';

// Constants for combat
const ARENA_WIDTH = 600;
const ARENA_HEIGHT = 400;
const UPDATE_INTERVAL = 16; // ~60fps
const UNIT_SIZE = 40;
const PROJECTILE_SIZE = 10;
const MAX_FIRE_RATE = 150; // Minimum ms between shots to prevent continuous firing
const BASE_SPEED = 300; // Base movement speed for player units
const DEBUG_MODE = false; // Disable debug logging
const MOVEMENT_SYNC_INTERVAL = 100; // How often to sync position in ms

// Socket event names - centralized for consistency
const SOCKET_EVENTS = {
  COMBAT_READY: 'arcadeCombatReady',
  PLAYER_READY: 'arcadeCombatPlayerReady',
  GAME_ACTIVE: 'arcadeCombatGameActive',
  COMBAT_UPDATE: 'arcadeCombatUpdate',
};

// Game action types for socket communications
const GAME_ACTIONS = {
  UNIT_DAMAGED: 'unitDamaged',
  UNIT_MOVED: 'unitMoved',
  PROJECTILE_FIRED: 'projectileFired',
};

// Centralized logging utility
const log = (message: string, data?: any, isWarning?: boolean) => {
  if (DEBUG_MODE) {
    if (data) {
      console.log(`[ArcadeCombat] ${message}`, data);
    } else {
      console.log(`[ArcadeCombat] ${message}`);
    }
  }
};

// Unit movement speed multipliers based on unit type
const SPEED_MULTIPLIERS: Record<string, number> = {
  'CHAMPION': 1.2,
  'SCOUT': 1.5,
  'DEFENDER': 0.8,
  'MAGE': 1.0
};

interface ArcadeCombatProps {
  battleState: BattleState;
  onBattleComplete: (winnerUnit: Unit) => void;
  currentPlayer: string;
}

interface CombatUnit extends Unit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  cooldown: number;
  projectiles: Projectile[];
  currentHealth: number;
  lastFired?: number;
  lastSyncTime?: number;
}

interface Projectile {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  owner: string;
}

// Input state type definition
interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}

/**
 * Helper function to detect collision between a projectile and a target unit
 * @param proj The projectile
 * @param targetUnit The target unit to check collision with
 * @returns True if collision detected, false otherwise
 */
const detectProjectileCollision = (proj: Projectile, targetUnit: CombatUnit): boolean => {
  return proj.x > targetUnit.x && 
    proj.x < targetUnit.x + UNIT_SIZE &&
    proj.y > targetUnit.y && 
    proj.y < targetUnit.y + UNIT_SIZE;
};

/**
 * Helper function to handle projectile collision with a target unit
 * @param targetUnit The unit hit by the projectile
 * @param damage The amount of damage to apply
 * @param socket The socket instance for multiplayer communication
 * @param battleState The current battle state
 * @returns The updated unit with new health
 */
const applyDamageToUnit = (
  targetUnit: CombatUnit, 
  damage: number, 
  socket: any, 
  battleState: BattleState | null
): CombatUnit => {
  // Calculate new health
  const newHealth = Math.max(0, targetUnit.currentHealth - damage);
  
  // Update the target unit's health
  const updatedUnit = {
    ...targetUnit,
    currentHealth: newHealth
  };
  
  // Log the hit
  log(`Unit ${targetUnit.id} hit! Health: ${newHealth}`);
  
  // Emit damage event
  if (socket && battleState) {
    socket.emit(SOCKET_EVENTS.COMBAT_UPDATE, {
      battleId: battleState.id,
      action: GAME_ACTIONS.UNIT_DAMAGED,
      targetUnitId: targetUnit.id,
      newHealth: newHealth
    });
  }
  
  return updatedUnit;
};

/**
 * Helper function to process projectile collisions for a single unit
 * @param unit The unit whose projectiles to check
 * @param targetUnit The target unit to check for collisions
 * @param socket The socket instance for multiplayer communication
 * @param battleState The current battle state
 * @returns Object containing remaining projectiles and the updated target unit
 */
const processProjectileCollisions = (
  unit: CombatUnit, 
  targetUnit: CombatUnit,
  socket: any,
  battleState: BattleState | null
) => {
  let updatedTargetUnit = { ...targetUnit };
  let hasCollision = false;
  
  // Check each projectile from this unit
  const remainingProjectiles = unit.projectiles.filter(proj => {
    // Use the collision detection helper
    const hitTarget = detectProjectileCollision(proj, targetUnit);
    
    if (hitTarget) {
      // Apply damage to the target unit
      updatedTargetUnit = applyDamageToUnit(updatedTargetUnit, proj.damage, socket, battleState);
      hasCollision = true;
      return false; // Remove this projectile
    }
    
    return true; // Keep the projectile
  });
  
  return { 
    remainingProjectiles, 
    updatedTargetUnit, 
    hasCollision 
  };
};

/**
 * Custom hook for throttling socket emissions to prevent flooding
 * @param socket The socket instance
 * @param throttleMs Throttle duration in milliseconds
 * @returns A function that safely emits throttled events
 */
const useThrottledEmit = (socket: any, throttleMs: number = 100) => {
  const lastEmitTimeRef = useRef<{[eventName: string]: number}>({});
  
  return useCallback((eventName: string, data: any) => {
    if (!socket) return;
    
    const now = Date.now();
    const lastEmitTime = lastEmitTimeRef.current[eventName] || 0;
    
    if (now - lastEmitTime > throttleMs) {
      socket.emit(eventName, data);
      lastEmitTimeRef.current[eventName] = now;
      log(`Emitted ${eventName} event`);
    }
  }, [socket, throttleMs]);
};

/**
 * Custom hook for handling keyboard inputs
 * @param currentPlayer The current player identifier
 * @param gameActive Whether the game is active
 * @returns The current input state and setters
 */
const useKeyboardControls = (currentPlayer: string, gameActive: boolean) => {
  const [inputState, setInputState] = useState<InputState>({
    up: false,
    down: false,
    left: false,
    right: false,
    fire: false
  });
  
  const keysPressed = useRef<{ [key: string]: boolean }>({});
  
  // Helper function to map a key to the corresponding input action based on player
  const mapKeyToAction = useCallback((key: string): keyof InputState | null => {
    if (currentPlayer === 'player1') {
      if (key === 'w') return 'up';
      if (key === 's') return 'down';
      if (key === 'a') return 'left';
      if (key === 'd') return 'right';
      if (key === ' ') return 'fire';
    } else {
      if (key === 'ArrowUp') return 'up';
      if (key === 'ArrowDown') return 'down';
      if (key === 'ArrowLeft') return 'left';
      if (key === 'ArrowRight') return 'right';
      if (key === 'Enter') return 'fire';
    }
    return null;
  }, [currentPlayer]);
  
  // Set up keyboard event handlers
  useEffect(() => {
    if (!gameActive) return;
    
    log(`Setting up keyboard handlers for player: ${currentPlayer}`);
    
    // Game control keys
    const gameKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', ' ', 'Enter'];
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!gameKeys.includes(e.key)) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const action = mapKeyToAction(e.key);
      if (action) {
        setInputState(prev => ({ ...prev, [action]: true }));
        keysPressed.current[e.key] = true;
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!gameKeys.includes(e.key)) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const action = mapKeyToAction(e.key);
      if (action) {
        setInputState(prev => ({ ...prev, [action]: false }));
        keysPressed.current[e.key] = false;
      }
    };
    
    // Attach keyboard event listeners with capture to ensure they're handled first
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    document.addEventListener('keyup', handleKeyUp, { capture: true });
    
    log('Keyboard handlers attached');
    
    // Clean up function
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('keyup', handleKeyUp, { capture: true });
      
      log('Keyboard handlers removed');
    };
  }, [gameActive, currentPlayer, mapKeyToAction]);
  
  // Helper to check key state 
  const isKeyPressed = useCallback((key: string): boolean => {
    const action = mapKeyToAction(key);
    if (action) return inputState[action];
    return keysPressed.current[key] === true;
  }, [inputState, mapKeyToAction]);
  
  // Input handling for touch/mouse events
  const handleInputEvent = useCallback((
    action: keyof InputState, 
    isActive: boolean, 
    e?: React.TouchEvent | React.MouseEvent
  ) => {
    if (e) e.preventDefault();
    setInputState(prev => ({ ...prev, [action]: isActive }));
  }, []);
  
  return {
    inputState,
    setInputState,
    isKeyPressed,
    handleInputEvent
  };
};

/**
 * Custom hook for managing the game animation loop
 * @param updateGameState The game state update function
 * @param gameActive Whether the game is active
 * @param combatUnits Current combat units for fire rate checking
 * @param inputState Current input state for debugging
 * @returns Request animation frame reference for cleanup
 */
const useAnimationLoop = (
  updateGameState: (deltaTime: number, canFire: {[key: string]: boolean}) => void,
  gameActive: boolean,
  combatUnits: CombatUnit[],
  inputState: InputState
) => {
  const requestRef = useRef<number | null>(null);
  const previousTimeRef = useRef<number | null>(null);
  const mountedRef = useRef<boolean>(true);
  
  useEffect(() => {
    // Set mounted state on component mount
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  
  useEffect(() => {
    if (!gameActive) {
      log('Game not active yet, not starting animation loop');
      return;
    }
    
    log('Starting animation loop');
    
    // Simple animation loop using requestAnimationFrame
    previousTimeRef.current = performance.now();
    
    const animate = (time: number) => {
      // Skip if component unmounted or game no longer active
      if (!mountedRef.current || !gameActive) {
        return;
      }
      
      // Calculate delta time in milliseconds
      const now = performance.now();
      const deltaTime = previousTimeRef.current ? now - previousTimeRef.current : 16;
      previousTimeRef.current = now;
      
      // Check which units can fire (rate limiting)
      const canFire: {[key: string]: boolean} = {};
      combatUnits.forEach(unit => {
        const lastFired = unit.lastFired || 0;
        canFire[unit.id] = (now - lastFired) > MAX_FIRE_RATE;
      });
      
      // Log current input state for debugging
      if (inputState.up || inputState.down || inputState.left || inputState.right || inputState.fire) {
        log('Input state:', inputState);
      }
      
      // Update game state with the calculated delta time
      updateGameState(deltaTime, canFire);
      
      // Continue the animation loop
      requestRef.current = requestAnimationFrame(animate);
    };
    
    // Start the animation loop
    requestRef.current = requestAnimationFrame(animate);
    
    // Clean up function
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
    };
  }, [gameActive, updateGameState, combatUnits, inputState]);
  
  return { requestRef, mountedRef };
};

/**
 * Custom hook for initializing the game state and handling player readiness
 * @param battleState The battle state object
 * @param currentPlayer The current player identifier
 * @param socket The socket instance for multiplayer communication
 * @returns Initialization state and error handling
 */
const useGameInitialization = (
  battleState: BattleState | null,
  currentPlayer: string,
  socket: any
) => {
  const [combatUnits, setCombatUnits] = useState<CombatUnit[]>([]);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [initializationError, setInitializationError] = useState<boolean>(false);
  const [playerReadyState, setPlayerReadyState] = useState<{[playerId: string]: boolean}>({});
  
  // Initialize combat - convert battle units to combat units
  useEffect(() => {
    if (!battleState || !battleState.attacker || !battleState.defender) {
      console.error('[ArcadeCombat] Invalid battle state:', battleState);
      return;
    }
    
    try {
      log('Initializing combat with battle state:', battleState);
      
      // Make sure the battle state has all required properties
      if (!battleState.attacker.stats || !battleState.defender.stats) {
        console.error('[ArcadeCombat] Battle units missing stats:', battleState);
        return;
      }
      
      // Create the combat units with positions based on player
      const combatUnitsList: CombatUnit[] = [];
      
      // Determine which unit belongs to which player
      const player1Unit = battleState.attacker.owner === 'player1' ? 
        battleState.attacker : battleState.defender;
      const player2Unit = battleState.attacker.owner === 'player2' ? 
        battleState.attacker : battleState.defender;
      
      // Initialize player1 unit (left side - blue)
      const blueUnit: CombatUnit = {
        ...player1Unit,
        x: 50,
        y: ARENA_HEIGHT / 2 - UNIT_SIZE / 2,
        vx: 0,
        vy: 0,
        cooldown: 0,
        projectiles: [],
        currentHealth: player1Unit.stats.health
      };
      
      // Initialize player2 unit (right side - red)
      const redUnit: CombatUnit = {
        ...player2Unit,
        x: ARENA_WIDTH - 50 - UNIT_SIZE,
        y: ARENA_HEIGHT / 2 - UNIT_SIZE / 2,
        vx: 0,
        vy: 0,
        cooldown: 0,
        projectiles: [],
        currentHealth: player2Unit.stats.health
      };
      
      combatUnitsList.push(blueUnit);
      combatUnitsList.push(redUnit);
      
      // Initialize the combat units
      setCombatUnits(combatUnitsList);
      setIsInitialized(true);
      
      log('Combat initialized with units:', combatUnitsList);
      
      // Set this player as ready
      if (currentPlayer) {
        setPlayerReadyState(prev => ({
          ...prev,
          [currentPlayer]: true
        }));
      }
      
      // If real-time connectivity is available, emit that we're ready
      if (socket) {
        log(`Emitting ${SOCKET_EVENTS.COMBAT_READY} event for battle ${battleState.id}`);
        socket.emit(SOCKET_EVENTS.COMBAT_READY, { battleId: battleState.id });
      }
    } catch (error) {
      console.error('[ArcadeCombat] Error initializing combat:', error);
      setInitializationError(true);
    }
  }, [battleState, socket, currentPlayer]);
  
  return {
    combatUnits,
    setCombatUnits,
    isInitialized,
    initializationError,
    playerReadyState,
    setPlayerReadyState,
  };
};

// Define action types for the combat units reducer
type CombatUnitAction = 
  | { type: 'UPDATE_PROJECTILES'; deltaTime: number; }
  | { type: 'CHECK_COLLISIONS'; winner: Unit | null; setWinner: (unit: Unit) => void; socket: any; battleState: BattleState | null; }
  | { type: 'MOVE_UNIT'; unitId: string; newX: number; newY: number; vx: number; vy: number; }
  | { type: 'FIRE_PROJECTILE'; unitId: string; projectile: Projectile; }
  | { type: 'UPDATE_HEALTH'; unitId: string; newHealth: number; }
  | { type: 'SET_ALL'; units: CombatUnit[]; };

/**
 * Helper function to update projectile positions
 * @param units Units with projectiles to update
 * @param deltaTime Time since last update in milliseconds
 * @returns Updated units with new projectile positions
 */
const updateProjectilePositions = (units: CombatUnit[], deltaTime: number): CombatUnit[] => {
  const clampedDeltaTime = Math.min(deltaTime, 100);
  
  return units.map(unit => ({
    ...unit,
    projectiles: unit.projectiles
      .map(proj => ({
        ...proj,
        x: proj.x + proj.vx * clampedDeltaTime / 1000,
        y: proj.y + proj.vy * clampedDeltaTime / 1000
      }))
      .filter(proj => proj.x > 0 && proj.x < ARENA_WIDTH && proj.y > 0 && proj.y < ARENA_HEIGHT)
  }));
};

/**
 * Helper function to check for collisions between projectiles and units
 * @param units Units to check for collisions
 * @param winner Current winner if any
 * @param setWinner Function to set winner
 * @param socket Socket for network updates
 * @param battleState Current battle state
 * @returns Updated units after collision detection
 */
const checkCollisions = (
  units: CombatUnit[], 
  winner: Unit | null, 
  setWinner: (unit: Unit) => void, 
  socket: any, 
  battleState: BattleState | null
): CombatUnit[] => {
  // Deep copy units to avoid mutation
  let updatedUnits = [...units];
  
  // Check for projectile collisions with units
  updatedUnits.forEach((unit, unitIndex) => {
    updatedUnits.forEach((targetUnit, targetIndex) => {
      if (unit.id === targetUnit.id) return; // Skip self
      
      // Process collisions for this unit's projectiles
      const { remainingProjectiles, updatedTargetUnit, hasCollision } = processProjectileCollisions(
        unit, 
        targetUnit,
        socket,
        battleState
      );
      
      // Update the units with collision results
      if (hasCollision) {
        updatedUnits[targetIndex] = updatedTargetUnit;
        
        // Check for winner
        if (updatedTargetUnit.currentHealth <= 0 && !winner) {
          log(`Unit ${targetUnit.id} defeated`);
          setWinner(unit);
        }
      }
      
      // Update unit's projectiles
      updatedUnits[unitIndex] = {
        ...unit,
        projectiles: remainingProjectiles
      };
    });
  });
  
  return updatedUnits;
};

/**
 * Reducer for managing combat units state
 * This separates the unit update logic from the component
 */
const combatUnitsReducer = (units: CombatUnit[], action: CombatUnitAction): CombatUnit[] => {
  switch (action.type) {
    case 'UPDATE_PROJECTILES':
      return updateProjectilePositions(units, action.deltaTime);
    
    case 'CHECK_COLLISIONS':
      return checkCollisions(
        units, 
        action.winner, 
        action.setWinner, 
        action.socket, 
        action.battleState
      );
    
    case 'MOVE_UNIT': {
      return units.map(unit => {
        if (unit.id === action.unitId) {
          return {
            ...unit,
            x: action.newX,
            y: action.newY,
            vx: action.vx,
            vy: action.vy
          };
        }
        return unit;
      });
    }
    
    case 'FIRE_PROJECTILE': {
      return units.map(unit => {
        if (unit.id === action.unitId) {
          return {
            ...unit,
            projectiles: [...unit.projectiles, action.projectile],
            lastFired: performance.now()
          };
        }
        return unit;
      });
    }
    
    case 'UPDATE_HEALTH': {
      return units.map(unit => {
        if (unit.id === action.unitId) {
          return {
            ...unit,
            currentHealth: action.newHealth
          };
        }
        return unit;
      });
    }
    
    case 'SET_ALL': {
      return action.units;
    }
    
    default:
      return units;
  }
};

/**
 * Custom hook for handling socket events related to the game
 * @param socket The socket instance
 * @param battleState The battle state object
 * @param currentPlayer The current player identifier
 * @param dispatchCombatUnits Dispatch function for combat units
 */
const useSocketHandlers = (
  socket: any,
  battleState: BattleState | null,
  currentPlayer: string,
  combatUnits: CombatUnit[],
  dispatchCombatUnits: React.Dispatch<CombatUnitAction>,
  winner: Unit | null,
  setWinner: React.Dispatch<React.SetStateAction<Unit | null>>,
  isInitialized: boolean,
  setPlayerReadyState: React.Dispatch<React.SetStateAction<{[playerId: string]: boolean}>>,
  gameActive: boolean,
  setGameActive: React.Dispatch<React.SetStateAction<boolean>>,
  countdown: number,
  setCountdown: React.Dispatch<React.SetStateAction<number>>
) => {
  // Memoize the battle ID for consistent reference
  const battleId = useMemo(() => battleState?.id, [battleState]);
  
  // Listen for player ready events
  useEffect(() => {
    if (!socket || !battleId || !isInitialized) return;
    
    log(`Setting up listener for ${SOCKET_EVENTS.PLAYER_READY} events`);
    
    const handlePlayerReady = (data: any) => {
      if (data.battleId !== battleId) return;
      
      log(`Player ${data.playerId} is ready for battle ${data.battleId}`);
      
      // Update the ready state for this player
      setPlayerReadyState(prev => ({
        ...prev,
        [data.playerId]: true
      }));
    };
    
    socket.on(SOCKET_EVENTS.PLAYER_READY, handlePlayerReady);
    
    return () => {
      socket.off(SOCKET_EVENTS.PLAYER_READY, handlePlayerReady);
    };
  }, [socket, battleId, isInitialized, setPlayerReadyState]);
  
  // Listen for game active events
  useEffect(() => {
    if (!socket || !battleId) return;
    
    const handleGameActive = (data: any) => {
      if (data.battleId !== battleId) return;
      
      log('Received arcadeCombatGameActive event:', data);
      
      // If we're not already in the active state, force it
      if (!gameActive && countdown > 0) {
        log('Forcing game to active state based on server event');
        setCountdown(0);
        setGameActive(true);
      }
    };
    
    socket.on(SOCKET_EVENTS.GAME_ACTIVE, handleGameActive);
    
    return () => {
      socket.off(SOCKET_EVENTS.GAME_ACTIVE, handleGameActive);
    };
  }, [socket, battleId, gameActive, countdown, setGameActive, setCountdown]);
  
  // Memoize the unit ID map for faster lookups
  const unitIdMap = useMemo(() => {
    const map: {[id: string]: CombatUnit} = {};
    combatUnits.forEach(unit => {
      map[unit.id] = unit;
    });
    return map;
  }, [combatUnits]);
  
  // Combat Sync - listen for opponent's moves if applicable
  useEffect(() => {
    if (!socket || !battleId) return;
    
    // Listen for arcade combat updates
    const handleCombatUpdate = (data: any) => {
      if (data.battleId !== battleId) return;
      
      // Handle different types of updates
      switch (data.action) {
        case GAME_ACTIONS.UNIT_DAMAGED: {
          // Only update if it's the target unit
          const targetUnitId = data.targetUnitId;
          const targetUnit = unitIdMap[targetUnitId];
          
          if (targetUnit) {
            const newHealth = Math.max(0, data.newHealth);
            log(`Unit ${targetUnitId} health updated to ${newHealth}`);
            
            dispatchCombatUnits({ 
              type: 'UPDATE_HEALTH', 
              unitId: targetUnitId, 
              newHealth 
            });
            
            // Check for winner if health dropped to zero
            if (newHealth <= 0 && !winner) {
              // Find the attacker unit
              const attackerUnit = combatUnits.find(u => u.id !== targetUnitId);
              if (attackerUnit) {
                log(`Unit ${targetUnitId} defeated`);
                setWinner(attackerUnit);
              }
            }
          }
          break;
        }
        
        case GAME_ACTIONS.UNIT_MOVED: {
          // Only update opponent's unit, not the local player's
          const unitId = data.unitId;
          const targetUnit = unitIdMap[unitId];
          
          if (targetUnit && targetUnit.owner !== currentPlayer) {
            // Ensure position stays within boundaries
            const boundedX = Math.max(0, Math.min(ARENA_WIDTH - UNIT_SIZE, data.position.x));
            const boundedY = Math.max(0, Math.min(ARENA_HEIGHT - UNIT_SIZE, data.position.y));
            
            log(`Applied opponent position update: x=${boundedX}, y=${boundedY}`);
            
            dispatchCombatUnits({
              type: 'MOVE_UNIT',
              unitId: unitId,
              newX: boundedX,
              newY: boundedY,
              vx: 0, // Reset velocity to prevent continued movement
              vy: 0
            });
          }
          break;
        }
        
        case GAME_ACTIONS.PROJECTILE_FIRED: {
          // Add the projectile to the opponent's unit
          const unitId = data.unitId;
          const targetUnit = unitIdMap[unitId];
          
          if (targetUnit && targetUnit.owner !== currentPlayer && data.projectile) {
            dispatchCombatUnits({
              type: 'FIRE_PROJECTILE',
              unitId: unitId,
              projectile: data.projectile
            });
          }
          break;
        }
      }
    };
    
    socket.on(SOCKET_EVENTS.COMBAT_UPDATE, handleCombatUpdate);
    
    return () => {
      socket.off(SOCKET_EVENTS.COMBAT_UPDATE, handleCombatUpdate);
    };
  }, [socket, battleId, currentPlayer, unitIdMap, combatUnits, winner, dispatchCombatUnits, setWinner]);
};

// Create an error boundary component
class ArcadeCombatErrorBoundary extends React.Component<
  { children: React.ReactNode, fallbackUI: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode, fallbackUI: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (DEBUG_MODE) {
      console.error("[ArcadeCombat] Error caught by boundary:", error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallbackUI;
    }
    return this.props.children;
  }
}

// Memoized CombatUnit component for better performance
const MemoizedCombatUnit = memo(({ 
  unit,
  unitSize
}: { 
  unit: CombatUnit,
  unitSize: number
}) => {
  return (
    <div
      key={unit.id}
      className={`combat-unit ${unit.owner === 'player1' ? 'player1' : 'player2'}`}
      style={{
        left: unit.x + 'px',
        top: unit.y + 'px',
        width: unitSize + 'px',
        height: unitSize + 'px',
        backgroundColor: unit.owner === 'player1' ? '#3498db' : '#e74c3c'
      }}
      role="img"
      aria-label={`${unit.owner === 'player1' ? 'Player 1' : 'Player 2'} ${unit.type} unit`}
    >
      {unit.type.charAt(0)}
      
      {/* Health bar */}
      <div className="health-bar-container">
        <div 
          className="health-bar" 
          style={{ 
            width: `${(unit.currentHealth / unit.stats.maxHealth) * 100}%`,
            backgroundColor: unit.owner === 'player1' ? '#2ecc71' : '#f39c12'
          }}
          aria-hidden="true"
        ></div>
      </div>
    </div>
  );
});

// Memoized Projectile component
const MemoizedProjectile = memo(({ 
  projectile,
  projectileSize
}: { 
  projectile: Projectile,
  projectileSize: number
}) => {
  return (
    <div
      key={projectile.id}
      className="projectile"
      style={{
        left: projectile.x + 'px',
        top: projectile.y + 'px',
        width: projectileSize + 'px',
        height: projectileSize + 'px',
        backgroundColor: projectile.owner === 'player1' ? '#3498db' : '#e74c3c'
      }}
      role="img"
      aria-hidden="true"
    ></div>
  );
});

/**
 * Helper function to get projectile direction based on input state and last known direction
 * @param inputState Current input state (keyboard/touch controls)
 * @param lastDirection Last known direction of movement
 * @param defaultDirection Default direction to use if no movement has occurred
 * @returns Normalized direction vector { x, y }
 */
const getProjectileDirection = (
  inputState: InputState, 
  lastDirection: { x: number, y: number },
  defaultDirection: { x: number, y: number }
): { x: number, y: number } => {
  let dirX = 0, dirY = 0;

  if (inputState.left) dirX = -1;
  else if (inputState.right) dirX = 1;

  if (inputState.up) dirY = -1;
  else if (inputState.down) dirY = 1;

  if (dirX !== 0 || dirY !== 0) {
    const magnitude = Math.sqrt(dirX ** 2 + dirY ** 2);
    return { x: dirX / magnitude, y: dirY / magnitude };
  }

  if (lastDirection && (lastDirection.x !== 0 || lastDirection.y !== 0)) {
    return lastDirection;
  }

  return defaultDirection;
};

const ArcadeCombat: React.FC<ArcadeCombatProps> = ({ 
  battleState, 
  onBattleComplete,
  currentPlayer
}) => {
  log('Initializing with battle state:', { 
    battleId: battleState?.id,
    attackerOwner: battleState?.attacker?.owner,
    defenderOwner: battleState?.defender?.owner,
    currentPlayer
  });

  // Component State
  const [countdown, setCountdown] = useState<number>(3);
  const [gameActive, setGameActive] = useState<boolean>(false);
  const [winner, setWinner] = useState<Unit | null>(null);
  const [bothPlayersReady, setBothPlayersReady] = useState<boolean>(false);
  
  // Refs
  const arenaRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<boolean>(true);
  const prevPropsRef = useRef<ArcadeCombatProps | null>(null);
  
  // Track prop changes to debug excessive re-renders
  useEffect(() => {
    const currentProps = { battleState, onBattleComplete, currentPlayer }; // Capture current props

    // Log changes if previous props existed
    if (prevPropsRef.current) {
      if (prevPropsRef.current.battleState !== currentProps.battleState) {
        console.warn('[ArcadeCombat Prop Change] battleState changed!', { prev: prevPropsRef.current.battleState, current: currentProps.battleState });
      }
      if (prevPropsRef.current.onBattleComplete !== currentProps.onBattleComplete) {
        // Note: Function identity changes are common if not memoized in parent
        console.warn('[ArcadeCombat Prop Change] onBattleComplete function identity changed!');
      }
      if (prevPropsRef.current.currentPlayer !== currentProps.currentPlayer) {
        console.warn('[ArcadeCombat Prop Change] currentPlayer changed!', { prev: prevPropsRef.current.currentPlayer, current: currentProps.currentPlayer });
      }
    }

    // Store current props for the next render's comparison
    prevPropsRef.current = currentProps;
  }); // No dependency array - runs every render
  
  // Get the socket instance
  const socket = (window as any).socket;
  
  // Initialize the game using custom hook
  const {
    combatUnits,
    isInitialized,
    initializationError,
    playerReadyState,
    setPlayerReadyState,
  } = useGameInitialization(battleState, currentPlayer, socket);
  
  // Use the reducer for combat units
  const [reducerCombatUnits, dispatchCombatUnits] = useReducer(combatUnitsReducer, []);
  
  // Effect to initialize the reducer state once combatUnits are ready
  const reducerInitializedRef = useRef(false);
  useEffect(() => {
    // Check if the hook has initialized, units are available, and reducer hasn't been populated yet
    if (isInitialized && combatUnits.length > 0 && !reducerInitializedRef.current) {
      log('Initializing reducer state with combat units:', combatUnits);
      dispatchCombatUnits({ type: 'SET_ALL', units: combatUnits });
      reducerInitializedRef.current = true; // Mark reducer as initialized
    }
  }, [isInitialized, combatUnits, dispatchCombatUnits]);
  
  // Set up keyboard and input handling
  const {
    inputState,
    handleInputEvent,
  } = useKeyboardControls(currentPlayer, gameActive);
  
  // Set up throttled socket emissions
  const throttledEmit = useThrottledEmit(socket, MOVEMENT_SYNC_INTERVAL);
  
  // Add refs to track last movement direction for each unit
  const lastDirectionsRef = useRef<{[unitId: string]: {x: number, y: number}}>({});
  
  // Dedicated ref to track the direction for firing projectiles
  // This specifically stores the direction the player intends to fire, separate from movement
  const lastFiringDirectionRef = useRef<{[unitId: string]: {x: number, y: number}}>({});
  
  // Define the updateGameState function using useCallback to prevent unnecessary re-renders
  const updateGameState = useCallback((deltaTime: number, canFire: {[key: string]: boolean}) => {
    // Skip if component unmounted or game not active
    if (!mountedRef.current || !gameActive) {
      return;
    }
    
    // Update projectile positions
    dispatchCombatUnits({ type: 'UPDATE_PROJECTILES', deltaTime });
    
    // Check for collisions
    dispatchCombatUnits({ 
      type: 'CHECK_COLLISIONS', 
      winner, 
      setWinner, 
      socket,
      battleState 
    });
    
    // Process each unit for movement
    reducerCombatUnits.forEach(unit => {
      // Only handle movement for the current player's unit
      if (unit.owner === currentPlayer) {
        // Extract the current input state into local variables for clarity
        const moveUp = inputState.up;
        const moveDown = inputState.down;
        const moveLeft = inputState.left;
        const moveRight = inputState.right;
        const isFiring = inputState.fire;
        
        // Set velocity based on inputs
        let vx = 0, vy = 0;
        const speed = BASE_SPEED * (SPEED_MULTIPLIERS[unit.type] || 1.0);
        
        // Apply movement based on current input state
        if (moveUp) vy = -speed;
        else if (moveDown) vy = speed;
        
        if (moveLeft) vx = -speed;
        else if (moveRight) vx = speed;
        
        // Calculate new position with boundary limits
        const newX = Math.max(0, Math.min(ARENA_WIDTH - UNIT_SIZE, unit.x + vx * deltaTime / 1000));
        const newY = Math.max(0, Math.min(ARENA_HEIGHT - UNIT_SIZE, unit.y + vy * deltaTime / 1000));
        
        // Update the unit's position
        dispatchCombatUnits({ 
          type: 'MOVE_UNIT', 
          unitId: unit.id, 
          newX, 
          newY, 
          vx, 
          vy 
        });
        
        // Store last movement direction if there is movement
        if (vx !== 0 || vy !== 0) {
          // Normalize the direction vector
          const magnitude = Math.sqrt(vx * vx + vy * vy);
          lastDirectionsRef.current[unit.id] = {
            x: vx / magnitude,
            y: vy / magnitude
          };
        }
        
        // Track the intended firing direction whenever directional keys are pressed
        // This is independent of whether the unit's position actually changes
        let inputDirectionX = 0, inputDirectionY = 0;
        
        if (moveLeft) inputDirectionX = -1;
        else if (moveRight) inputDirectionX = 1;
        
        if (moveUp) inputDirectionY = -1;
        else if (moveDown) inputDirectionY = 1;
        
        if (inputDirectionX !== 0 || inputDirectionY !== 0) {
          const magnitude = Math.sqrt(inputDirectionX ** 2 + inputDirectionY ** 2);
          lastFiringDirectionRef.current[unit.id] = {
            x: inputDirectionX / magnitude,
            y: inputDirectionY / magnitude
          };
        }
        
        // Handle firing projectiles
        if (isFiring && canFire[unit.id]) {
          const projectileId = `proj-${unit.id}-${Date.now()}`;
          const projectileSpeed = 400; // pixels per second
          
          // Default direction (right for player1, left for player2)
          const defaultDirection = {
            x: unit.owner === 'player1' ? 1 : -1,
            y: 0
          };
          
          // Get the firing direction based on input state and last firing direction
          // Use the dedicated lastFiringDirectionRef for more consistent behavior
          const direction = getProjectileDirection(
            inputState,
            lastFiringDirectionRef.current[unit.id] || defaultDirection,
            defaultDirection
          );
          
          const projectile: Projectile = {
            id: projectileId,
            x: unit.x + UNIT_SIZE / 2,
            y: unit.y + UNIT_SIZE / 2,
            vx: direction.x * projectileSpeed,
            vy: direction.y * projectileSpeed,
            damage: unit.stats.attack,
            owner: unit.owner
          };
          
          // Add the projectile
          dispatchCombatUnits({ 
            type: 'FIRE_PROJECTILE', 
            unitId: unit.id, 
            projectile 
          });
          
          // Emit projectile fired event if socket available
          if (socket && battleState) {
            throttledEmit(SOCKET_EVENTS.COMBAT_UPDATE, {
              battleId: battleState.id,
              action: GAME_ACTIONS.PROJECTILE_FIRED,
              unitId: unit.id,
              projectile
            });
          }
        }
        
        // Emit movement update ONLY if there's meaningful movement
        if ((Math.abs(newX - unit.x) > 1 || Math.abs(newY - unit.y) > 1) && socket && battleState) {
          throttledEmit(SOCKET_EVENTS.COMBAT_UPDATE, {
            battleId: battleState.id,
            action: GAME_ACTIONS.UNIT_MOVED,
            unitId: unit.id,
            position: { x: newX, y: newY },
            velocity: { vx: 0, vy: 0 } // Send zero velocity to ensure opponent stops at the exact position
          });
        }
      }
    });
  }, [inputState, currentPlayer, battleState, socket, winner, gameActive, reducerCombatUnits, throttledEmit]);
  
  // Set up the animation loop
  const { requestRef } = useAnimationLoop(updateGameState, gameActive, reducerCombatUnits, inputState);
  
  // Set up socket handlers
  useSocketHandlers(
    socket,
    battleState,
    currentPlayer,
    reducerCombatUnits,
    dispatchCombatUnits,
    winner,
    setWinner,
    isInitialized,
    setPlayerReadyState,
    gameActive,
    setGameActive,
    countdown,
    setCountdown
  );
  
  // Memoize the player ready states to prevent unnecessary re-renders
  const playerReadyInfo = useMemo(() => {
    const player1Ready = playerReadyState['player1'] || false;
    const player2Ready = playerReadyState['player2'] || false;
    return { player1Ready, player2Ready };
  }, [playerReadyState]);
  
  // Check if both players are ready
  useEffect(() => {
    if (!battleState) return;
    
    const { player1Ready, player2Ready } = playerReadyInfo;
    
    log(`Player ready states: player1=${player1Ready}, player2=${player2Ready}`);
    
    // For debugging: after 5 seconds, set bothPlayersReady=true if at least one player is ready
    // This ensures the game will start even if one player's readiness state is lost
    const timeoutId = setTimeout(() => {
      if ((player1Ready || player2Ready) && !bothPlayersReady) {
        log('Failsafe: Starting game after timeout with at least one player ready', null, true);
        setBothPlayersReady(true);
      }
    }, 5000);
    
    // If both players are ready, start the countdown
    if (player1Ready && player2Ready && !bothPlayersReady) {
      log('Both players are ready, setting bothPlayersReady to true');
      setBothPlayersReady(true);
    }
    
    return () => clearTimeout(timeoutId);
  }, [playerReadyInfo, battleState, bothPlayersReady]);

  // Add a specific effect for the countdown
  useEffect(() => {
    if (!isInitialized) return;
    
    // Force bothPlayersReady to true after a timeout if it's still false
    // This is a failsafe to ensure the game starts
    const timeoutId = setTimeout(() => {
      if (!bothPlayersReady) {
        log('Failsafe: Setting bothPlayersReady to true after timeout', null, true);
        setBothPlayersReady(true);
      }
    }, 3000);
    
    if (!bothPlayersReady) {
      return () => clearTimeout(timeoutId);
    }
    
    log('Starting countdown from', countdown);
    
    // Start countdown when initialized
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        log('Countdown tick:', prev - 1);
        if (prev <= 1) {
          // Clear interval when countdown reaches 0
          clearInterval(countdownInterval);
          // Set game to active state
          setGameActive(true);
          
          // Notify server that this player's game is active
          if (socket && battleState) {
            log('Emitting arcadeCombatGameActive');
            socket.emit(SOCKET_EVENTS.GAME_ACTIVE, { 
              battleId: battleState.id,
              playerId: currentPlayer 
            });
          }
          
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    // Clean up interval on unmount
    return () => {
      clearTimeout(timeoutId);
      clearInterval(countdownInterval);
    };
  }, [isInitialized, bothPlayersReady, countdown, battleState, socket, currentPlayer]);

  // Winner effect - when we have a winner, end the combat
  useEffect(() => {
    if (winner) {
      log('Combat ended with winner:', winner);
      
      // Delay slightly to show the winning state
      const timeout = setTimeout(() => {
        if (mountedRef.current && onBattleComplete) {
          onBattleComplete(winner);
        }
      }, 1000);
      
      return () => clearTimeout(timeout);
    }
  }, [winner, onBattleComplete]);

  // Focus the arena when game becomes active
  useEffect(() => {
    if (gameActive && arenaRef.current) {
      // Small delay to ensure the DOM is ready
      setTimeout(() => {
        if (arenaRef.current) {
          arenaRef.current.focus();
          log('Arena focused after game became active');
        }
      }, 100);
    }
  }, [gameActive]);

  // Create a fallback UI for errors
  const fallbackUI = useMemo(() => (
    <div className="arcade-combat-overlay">
      <div className="arcade-combat-container">
        <div className="arcade-error-message" role="alert" aria-live="assertive">
          There was an error in the combat. The turn will continue.
        </div>
        <button
          onClick={() => {
            try {
              onBattleComplete({
                id: 'error-recovery',
                type: 'CHAMPION' as UnitType,
                position: { x: 0, y: 0 },
                owner: currentPlayer || 'player1',
                stats: { health: 100, maxHealth: 100, speed: 5, attack: 10, defense: 5 }
              });
            } catch (error) {
              if (DEBUG_MODE) {
                console.error('[ArcadeCombat] Error ending battle from error UI:', error);
              }
              window.location.reload(); // Last resort recovery
            }
          }}
          className="arcade-error-button"
        >
          Continue
        </button>
      </div>
    </div>
  ), [currentPlayer, onBattleComplete]);

  // Show error UI if initialization failed
  if (initializationError) {
    return fallbackUI;
  }

  // Generalized handler for touch/mouse events
  const createControlHandler = (action: keyof InputState, isActive: boolean) => 
    (e: React.TouchEvent | React.MouseEvent) => handleInputEvent(action, isActive, e);

  // Create a memoized list of projectiles from all units for better rendering performance
  const allProjectiles = useMemo(() => {
    return reducerCombatUnits.flatMap(unit => unit.projectiles);
  }, [reducerCombatUnits]);

  // Wrap the component in an error boundary
  return (
    <ArcadeCombatErrorBoundary fallbackUI={fallbackUI}>
      <div className="arcade-combat-overlay">
        <div className="arcade-combat-container">
          {/* Show countdown or arena */}
          {countdown > 0 ? (
            <div className="countdown" role="timer" aria-live="polite" aria-atomic="true">{countdown}</div>
          ) : (
            <div className="arcade-game-container" aria-label="Combat arena">
              <div 
                ref={arenaRef}
                className="arcade-combat-arena"
                style={{ width: ARENA_WIDTH, height: ARENA_HEIGHT }}
                tabIndex={0} // Make the div focusable
                role="application"
                aria-label="Arcade combat game"
                onFocus={() => {
                  log('Arena focused');
                  if (arenaRef.current) {
                    arenaRef.current.classList.add('arena-active');
                  }
                }}
                onBlur={() => {
                  log('Arena blurred');
                  // Immediately try to get focus back
                  setTimeout(() => {
                    if (arenaRef.current && gameActive) {
                      arenaRef.current.focus();
                      log('Re-focused arena after blur');
                    }
                  }, 0);
                }}
                onClick={() => {
                  // Ensure click gives focus to the arena
                  if (arenaRef.current) {
                    arenaRef.current.focus();
                    log('Focus set on arena after click');
                  }
                }}
              >
                {/* Render units */}
                {reducerCombatUnits.map(unit => (
                  <MemoizedCombatUnit
                    key={unit.id}
                    unit={unit}
                    unitSize={UNIT_SIZE}
                  />
                ))}
                
                {/* Render projectiles */}
                {allProjectiles.map(proj => (
                  <MemoizedProjectile
                    key={proj.id}
                    projectile={proj}
                    projectileSize={PROJECTILE_SIZE}
                  />
                ))}
                
                {/* Winner display */}
                {winner && (
                  <div 
                    className="winner-display" 
                    role="alert" 
                    aria-live="assertive"
                  >
                    <h2>{winner.owner === 'player1' ? 'Player 1' : 'Player 2'} Wins!</h2>
                  </div>
                )}
              </div>
              
              {/* Touch Controls - using the simplified event handlers */}
              <div className="touch-controls" aria-label="Touch controls">
                <div className="d-pad">
                  <button 
                    className="d-pad-up"
                    onTouchStart={createControlHandler('up', true)}
                    onTouchEnd={createControlHandler('up', false)}
                    onMouseDown={createControlHandler('up', true)}
                    onMouseUp={createControlHandler('up', false)}
                    onMouseLeave={createControlHandler('up', false)}
                    aria-label="Move up"
                  >↑</button>
                  <button 
                    className="d-pad-left"
                    onTouchStart={createControlHandler('left', true)}
                    onTouchEnd={createControlHandler('left', false)}
                    onMouseDown={createControlHandler('left', true)}
                    onMouseUp={createControlHandler('left', false)}
                    onMouseLeave={createControlHandler('left', false)}
                    aria-label="Move left"
                  >←</button>
                  <button 
                    className="d-pad-right"
                    onTouchStart={createControlHandler('right', true)}
                    onTouchEnd={createControlHandler('right', false)}
                    onMouseDown={createControlHandler('right', true)}
                    onMouseUp={createControlHandler('right', false)}
                    onMouseLeave={createControlHandler('right', false)}
                    aria-label="Move right"
                  >→</button>
                  <button 
                    className="d-pad-down"
                    onTouchStart={createControlHandler('down', true)}
                    onTouchEnd={createControlHandler('down', false)}
                    onMouseDown={createControlHandler('down', true)}
                    onMouseUp={createControlHandler('down', false)}
                    onMouseLeave={createControlHandler('down', false)}
                    aria-label="Move down"
                  >↓</button>
                </div>
                <button 
                  className="fire-button"
                  onTouchStart={createControlHandler('fire', true)}
                  onTouchEnd={createControlHandler('fire', false)}
                  onMouseDown={createControlHandler('fire', true)}
                  onMouseUp={createControlHandler('fire', false)}
                  onMouseLeave={createControlHandler('fire', false)}
                  aria-label="Fire weapon"
                >FIRE</button>
              </div>
            </div>
          )}
          
          {/* Controls display */}
          <div className="controls-display" aria-label="Game controls information">
            <div className="controls-player1">
              <span>Player 1: WASD to move, Space to shoot</span>
            </div>
            <div className="controls-player2">
              <span>Player 2: Arrow keys to move, Enter to shoot</span>
            </div>
          </div>
        </div>
      </div>
    </ArcadeCombatErrorBoundary>
  );
};

export default React.memo(ArcadeCombat); 