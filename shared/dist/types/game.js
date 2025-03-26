"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameActionType = exports.PowerUpType = exports.GamePhase = exports.TileType = exports.UnitType = void 0;
var UnitType;
(function (UnitType) {
    UnitType["WARRIOR"] = "WARRIOR";
    UnitType["WIZARD"] = "WIZARD";
    UnitType["ARCHER"] = "ARCHER";
    UnitType["KNIGHT"] = "KNIGHT";
    UnitType["DRAGON"] = "DRAGON";
})(UnitType || (exports.UnitType = UnitType = {}));
var TileType;
(function (TileType) {
    TileType["EMPTY"] = "EMPTY";
    TileType["WALL"] = "WALL";
    TileType["PORTAL"] = "PORTAL";
    TileType["POWER_NODE"] = "POWER_NODE";
})(TileType || (exports.TileType = TileType = {}));
var GamePhase;
(function (GamePhase) {
    GamePhase["TURN_BASED"] = "TURN_BASED";
    GamePhase["BATTLE"] = "BATTLE";
})(GamePhase || (exports.GamePhase = GamePhase = {}));
var PowerUpType;
(function (PowerUpType) {
    PowerUpType["HEALTH"] = "HEALTH";
    PowerUpType["SPEED"] = "SPEED";
    PowerUpType["STRENGTH"] = "STRENGTH";
})(PowerUpType || (exports.PowerUpType = PowerUpType = {}));
var GameActionType;
(function (GameActionType) {
    GameActionType["MOVE"] = "MOVE";
    GameActionType["ATTACK"] = "ATTACK";
    GameActionType["SPECIAL_ABILITY"] = "SPECIAL_ABILITY";
    GameActionType["END_TURN"] = "END_TURN";
})(GameActionType || (exports.GameActionType = GameActionType = {}));
