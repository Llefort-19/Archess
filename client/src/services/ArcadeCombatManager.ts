import { GameState, Unit, BattleState, GamePhase, UnitType } from '@archess/shared';

class ArcadeCombatManager {
  private static instance: ArcadeCombatManager;
  private activeBattle: BattleState | null = null;
  private listeners: Array<(battleState: BattleState | null) => void> = [];
  private battleInitialized: boolean = false;
  private socket: any;

  private constructor() {
    // Get the socket from window
    this.socket = (window as any).socket;
    this.setupGlobalEventListeners();
    
    console.log('ArcadeCombatManager initialized');
  }

  public static getInstance(): ArcadeCombatManager {
    if (!ArcadeCombatManager.instance) {
      ArcadeCombatManager.instance = new ArcadeCombatManager();
    }
    return ArcadeCombatManager.instance;
  }

  private setupGlobalEventListeners() {
    if (this.socket) {
      // Clean up any existing listeners to avoid duplicates
      this.socket.off('battleStarted');
      this.socket.off('gameStateUpdated');
      
      // Listen for battle events from the server
      this.socket.on('battleStarted', (battleData: any) => {
        console.log('Battle event received from server:', battleData);
        
        if (battleData && battleData.battle) {
          // Convert the received battle data into a proper BattleState
          this.activeBattle = this.createBattleStateFromData(battleData.battle);
          this.battleInitialized = true;
          
          // Make sure we notify all listeners of the new battle
          console.log('Activating battle from battleStarted event');
          this.notifyListeners();
          
          // Additionally, emit arcadeCombatReady event on behalf of the current player
          // This ensures both players will mark themselves as ready
          setTimeout(() => {
            if (this.socket && this.activeBattle) {
              console.log('Auto-emitting arcadeCombatReady event');
              this.socket.emit('arcadeCombatReady', { battleId: this.activeBattle.id });
            }
          }, 500);
        }
      });
      
      // Listen for game state updates that might indicate battles
      this.socket.on('gameStateUpdated', (updatedGameState: any) => {
        console.log('Game state updated, checking for battles');
        
        // If we don't have an active battle, check if we should
        if (!this.activeBattle) {
          this.syncBattleState(updatedGameState);
        }
      });

      // Remove broadcastBattle listener if it already exists
      this.socket.off('broadcastBattle');

      // No need to listen for broadcastBattle events on the client side
      // We now use the server-relayed battleStarted event instead
    } else {
      console.warn('Socket not available for ArcadeCombatManager');
    }
  }

  private createBattleStateFromData(battleData: any): BattleState {
    try {
      // Make sure both attacker and defender have complete stats
      const attacker = this.ensureCompleteUnit(battleData.attacker);
      const defender = this.ensureCompleteUnit(battleData.defender);
      
      return {
        id: battleData.id || `battle-${Date.now()}`,
        attacker,
        defender,
        arena: battleData.arena || {
          width: 20,
          height: 15,
          obstacles: [],
          powerUps: []
        },
        startTime: battleData.startTime || Date.now()
      };
    } catch (error) {
      console.error('Error creating battle state from data:', error);
      // Create a default battle state
      return {
        id: `battle-${Date.now()}`,
        attacker: this.createDefaultUnit('player1'),
        defender: this.createDefaultUnit('player2'),
        arena: {
          width: 20,
          height: 15,
          obstacles: [],
          powerUps: []
        },
        startTime: Date.now()
      };
    }
  }

  private ensureCompleteUnit(unit: any): Unit {
    if (!unit) {
      return this.createDefaultUnit('player1');
    }
    
    // Default stats
    const defaultStats = {
      health: 100,
      maxHealth: 100,
      speed: 5,
      attack: 10,
      defense: 5
    };
    
    // Ensure unit has all required properties
    return {
      id: unit.id || `unit-${Date.now()}-${Math.random()}`,
      type: unit.type || ('CHAMPION' as UnitType),
      position: unit.position || { x: 0, y: 0 },
      owner: unit.owner || 'player1',
      stats: {
        health: unit.stats?.health || defaultStats.health,
        maxHealth: unit.stats?.maxHealth || defaultStats.maxHealth,
        speed: unit.stats?.speed || defaultStats.speed,
        attack: unit.stats?.attack || defaultStats.attack,
        defense: unit.stats?.defense || defaultStats.defense
      }
    };
  }

  private createDefaultUnit(owner: string): Unit {
    return {
      id: `default-unit-${Date.now()}-${Math.random()}`,
      type: 'CHAMPION' as UnitType,
      position: { x: 0, y: 0 },
      owner,
      stats: {
        health: 100,
        maxHealth: 100,
        speed: 5,
        attack: 10,
        defense: 5
      }
    };
  }

  private syncBattleState(gameState: any) {
    if (!gameState || this.activeBattle) return;

    const units = gameState.board?.units || [];
    const positions: {[key: string]: Unit[]} = {};

    // Group units by position
    units.forEach((unit: Unit) => {
      if (!unit || !unit.position) return;
      
      const posKey = `${unit.position.x},${unit.position.y}`;
      if (!positions[posKey]) {
        positions[posKey] = [];
      }
      positions[posKey].push(this.deepClone(unit));
    });

    // Find positions with multiple units from different players
    for (const posKey in positions) {
      const unitsAtPos = positions[posKey];
      if (unitsAtPos.length > 1) {
        const owners = new Set(unitsAtPos.map(u => u.owner));
        if (owners.size > 1) {
          console.log('Found units from different players at same position:', unitsAtPos);
          
          // Create and activate battle
          const attacker = unitsAtPos[0];
          const defender = unitsAtPos[1];
          
          if (this.isValidUnit(attacker) && this.isValidUnit(defender) && attacker.owner !== defender.owner) {
            // Create battle state
            const battle = this.createBattleState(attacker, defender);
            
            // Broadcast the battle to all clients
            this.broadcastBattle(battle);
            
            // Local activation
            this.activateBattle(battle);
            break;
          }
        }
      }
    }
  }

  private broadcastBattle(battle: BattleState) {
    if (this.socket) {
      console.log('Broadcasting battle to all clients:', battle);
      this.socket.emit('broadcastBattle', { battle });
    }
  }

  /**
   * Check if a battle should be triggered based on game state
   * This is called after a unit move is completed
   */
  public checkForBattle(gameState: GameState, movedUnit: Unit): BattleState | null {
    console.log('Checking for battle', { 
      movedUnit, 
      position: movedUnit.position,
      phase: gameState.phase,
      allUnits: gameState.board.units.map(u => ({ id: u.id, owner: u.owner, position: u.position }))
    });
    
    // Only check in turn-based phase
    if (gameState.phase !== GamePhase.TURN_BASED) {
      console.log('Not in turn-based phase, skipping battle check');
      return null;
    }
    
    // Validate the moved unit has all required properties
    if (!movedUnit || !movedUnit.id || !movedUnit.position || !movedUnit.owner) {
      console.error('Invalid moved unit in checkForBattle:', movedUnit);
      return null;
    }

    // Find any unit at the moved unit's position that belongs to a different player
    const unitsAtPosition = gameState.board.units.filter(
      u => 
        u && u.id && // Ensure unit is valid
        u.id !== movedUnit.id && // Skip the moved unit itself
        u.position && // Ensure position exists
        u.position.x === movedUnit.position.x && 
        u.position.y === movedUnit.position.y && 
        u.owner && u.owner !== movedUnit.owner // Different owner
    );
    
    console.log('Units at position', unitsAtPosition);

    // If there's an opposing unit at the same position, trigger battle
    if (unitsAtPosition.length > 0) {
      const opposingUnit = unitsAtPosition[0];
      
      // Final validation check for both units
      if (!this.isValidUnit(movedUnit) || !this.isValidUnit(opposingUnit)) {
        console.error('Invalid units for battle:', {
          movedUnit,
          opposingUnit
        });
        return null;
      }
      
      console.log('Battle triggered!', opposingUnit);
      
      // Create the battle state
      const battle = this.createBattleState(movedUnit, opposingUnit);
      
      // Broadcast the battle to the server which will relay to all clients
      this.broadcastBattle(battle);
      
      // Don't activate the battle locally - wait for the server's battleStarted event
      // The server will send the battle data back to all clients, including this one
      // This ensures perfect synchronization
      
      return battle;
    }
    
    console.log('No battle triggered');
    return null;
  }

  /**
   * Create a complete battle state from two units
   */
  private createBattleState(attacker: Unit, defender: Unit): BattleState {
    // Ensure both units have complete stats
    const createCompleteUnit = (unit: Unit): Unit => {
      // Deep clone the unit to avoid reference issues
      const clonedUnit = this.deepClone(unit);
      
      // Default stats
      const defaultStats = {
        health: 100,
        maxHealth: 100,
        speed: 5,
        attack: 10,
        defense: 5
      };
      
      return {
        ...clonedUnit,
        // Ensure position is valid
        position: clonedUnit.position || { x: 0, y: 0 },
        // Ensure stats object is complete
        stats: clonedUnit.stats ? {
          health: clonedUnit.stats.health || defaultStats.health,
          maxHealth: clonedUnit.stats.maxHealth || defaultStats.maxHealth,
          speed: clonedUnit.stats.speed || defaultStats.speed,
          attack: clonedUnit.stats.attack || defaultStats.attack,
          defense: clonedUnit.stats.defense || defaultStats.defense
        } : defaultStats
      };
    };
    
    // Create a battle state with complete units
    const battle: BattleState = {
      id: `battle-${Date.now()}`,
      attacker: createCompleteUnit(attacker),
      defender: createCompleteUnit(defender),
      arena: {
        width: 20,
        height: 15,
        obstacles: [],
        powerUps: []
      },
      startTime: Date.now()
    };
    
    console.log('Created battle state with units:', {
      attacker: battle.attacker,
      defender: battle.defender
    });
    
    return battle;
  }
  
  /**
   * Activate a battle and notify all listeners
   */
  private activateBattle(battle: BattleState): BattleState {
    this.activeBattle = battle;
    this.battleInitialized = true;
    this.notifyListeners();
    return battle;
  }
  
  /**
   * Deep clone an object to avoid reference issues
   */
  private deepClone<T>(obj: T): T {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      console.error('Failed to deep clone object:', e);
      return obj; // Return original if clone fails
    }
  }
  
  /**
   * Validate that a unit has all required properties
   */
  private isValidUnit(unit: Unit): boolean {
    return !!(
      unit && 
      unit.id && 
      unit.position && 
      typeof unit.position.x === 'number' && 
      typeof unit.position.y === 'number' && 
      unit.owner && 
      unit.type
    );
  }

  /**
   * Handle the completion of a battle
   */
  public completeBattle(winnerUnit: Unit): void {
    console.log('Battle completed, winner:', winnerUnit);
    
    if (!this.activeBattle) {
      console.warn('No active battle to complete');
      return;
    }
    
    // Log battle outcome
    console.log('Battle outcome:', {
      battleId: this.activeBattle.id,
      attacker: this.activeBattle.attacker.id,
      defender: this.activeBattle.defender.id,
      winner: winnerUnit.id
    });
    
    this.activeBattle = null;
    this.battleInitialized = false;
    this.notifyListeners();
    
    console.log('Battle state cleared, listeners notified');
  }

  /**
   * Get the current active battle, if any
   */
  public getActiveBattle(): BattleState | null {
    return this.activeBattle;
  }

  /**
   * Register a listener for battle state changes
   */
  public addBattleListener(listener: (battleState: BattleState | null) => void): void {
    this.listeners.push(listener);
    
    // Immediately notify the new listener if there's an active battle
    if (this.activeBattle) {
      listener(this.activeBattle);
    }
  }

  /**
   * Remove a listener
   */
  public removeBattleListener(listener: (battleState: BattleState | null) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Notify all listeners of battle state changes
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.activeBattle);
      } catch (error) {
        console.error('Error notifying battle listener:', error);
      }
    }
  }
}

export default ArcadeCombatManager; 