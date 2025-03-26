export type PlayerId = string;
export interface Position {
    x: number;
    y: number;
}
export interface UnitStats {
    health: number;
    maxHealth: number;
    speed: number;
    attack: number;
    defense: number;
    specialAbility?: SpecialAbility;
}
export interface SpecialAbility {
    name: string;
    damage: number;
    cooldown: number;
    range: number;
    currentCooldown: number;
}
export interface Unit {
    id: string;
    type: UnitType;
    position: Position;
    owner: PlayerId;
    stats: UnitStats;
}
export declare enum UnitType {
    WARRIOR = "WARRIOR",
    WIZARD = "WIZARD",
    ARCHER = "ARCHER",
    KNIGHT = "KNIGHT",
    DRAGON = "DRAGON"
}
export interface GameState {
    id: string;
    board: Board;
    currentTurn: PlayerId;
    phase: GamePhase;
    players: Player[];
    activeBattle?: BattleState;
}
export interface Board {
    width: number;
    height: number;
    units: Unit[];
    tiles: TileType[][];
}
export declare enum TileType {
    EMPTY = "EMPTY",
    WALL = "WALL",
    PORTAL = "PORTAL",
    POWER_NODE = "POWER_NODE"
}
export declare enum GamePhase {
    TURN_BASED = "TURN_BASED",
    BATTLE = "BATTLE"
}
export interface Player {
    id: PlayerId;
    name: string;
    color: string;
}
export interface BattleState {
    id: string;
    attacker: Unit;
    defender: Unit;
    arena: Arena;
    startTime: number;
}
export interface Arena {
    width: number;
    height: number;
    obstacles: Position[];
    powerUps: PowerUp[];
}
export interface PowerUp {
    position: Position;
    type: PowerUpType;
    effect: PowerUpEffect;
}
export declare enum PowerUpType {
    HEALTH = "HEALTH",
    SPEED = "SPEED",
    STRENGTH = "STRENGTH"
}
export interface PowerUpEffect {
    type: PowerUpType;
    value: number;
    duration: number;
}
export interface GameAction {
    type: GameActionType;
    playerId: PlayerId;
    unitId: string;
    targetPosition?: Position;
    timestamp: number;
}
export declare enum GameActionType {
    MOVE = "MOVE",
    ATTACK = "ATTACK",
    SPECIAL_ABILITY = "SPECIAL_ABILITY",
    END_TURN = "END_TURN"
}
