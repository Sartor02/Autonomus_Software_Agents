import { BAN_DURATION, DIRECTIONS, ACTIONS } from "../utils/utils.js";

export class ExplorationManager {
    constructor(beliefs, pathfinder) {
        this.beliefs = beliefs;
        this.pathfinder = pathfinder;
        this.explorationMap = new Map();
        this.explorationPath = [];
        this.bannedExplorationTiles = new Map();
        this.currentTurn = 0;
    }

    incrementTurn() {
        this.currentTurn += 1;
        this.cleanupExpiredBans();
    }

    cleanupExpiredBans() {
        const bannedTileKeysToRemove = [];
        for (const [tileKey, banUntilTurn] of this.bannedExplorationTiles.entries()) {
            if (this.currentTurn >= banUntilTurn) {
                bannedTileKeysToRemove.push(tileKey);
            }
        }
        bannedTileKeysToRemove.forEach(key => this.bannedExplorationTiles.delete(key));
    }

    findExplorationTargetTile(currentX, currentY, bannedThisTurn = new Set()) {
        // 1. Try assigned area first
        if (this.beliefs.myAssignedArea && this.beliefs.myAssignedArea.length > 0) {
            const available = this.beliefs.myAssignedArea.filter(tile => {
                const tileKey = `${tile.x},${tile.y}`;
                return (!this.bannedExplorationTiles.has(tileKey) || this.bannedExplorationTiles.get(tileKey) <= this.currentTurn)
                    && !bannedThisTurn.has(tileKey);
            });
            if (available.length > 0) {
                return this.findLeastVisitedTile(currentX, currentY, available);
            }
        }

        // 2. Try other spawn areas
        const allAreas = this.beliefs.getSpawnAreasFromTiles();
        let minDist = Infinity, bestTile = null;
        for (const area of allAreas) {
            if (this.beliefs.myAssignedArea && area === this.beliefs.myAssignedArea) continue;
            for (const tile of area) {
                const tileKey = `${tile.x},${tile.y}`;
                if ((this.bannedExplorationTiles.has(tileKey) && this.bannedExplorationTiles.get(tileKey) > this.currentTurn)
                    || bannedThisTurn.has(tileKey)) continue;
                const dist = Math.abs(tile.x - currentX) + Math.abs(tile.y - currentY);
                if (dist < minDist) {
                    minDist = dist;
                    bestTile = tile;
                }
            }
        }
        if (bestTile) return bestTile;

        // 3. Fallback to spawn tiles
        const fallbackTiles = this.beliefs.getSpawnTiles().filter(tile => {
            const tileKey = `${tile.x},${tile.y}`;
            return (!this.bannedExplorationTiles.has(tileKey) || this.bannedExplorationTiles.get(tileKey) <= this.currentTurn)
                && !bannedThisTurn.has(tileKey);
        });
        if (fallbackTiles.length > 0) {
            return this.findLeastVisitedTile(currentX, currentY, fallbackTiles);
        }

        // 4. Final fallback to normal tiles
        const normalTilesNotBanned = this.beliefs.getNormalTiles().filter(tile => {
            const tileKey = `${tile.x},${tile.y}`;
            return (!this.bannedExplorationTiles.has(tileKey) || this.bannedExplorationTiles.get(tileKey) <= this.currentTurn)
                && !bannedThisTurn.has(tileKey);
        });
        if (normalTilesNotBanned.length > 0) {
            return this.findLeastVisitedTile(currentX, currentY, normalTilesNotBanned);
        }

        return null;
    }

    findLeastVisitedTile(currentX, currentY, tiles, bannedThisTurn = new Set()) {
        if (tiles.length === 0) return null;

        let minVisits = Infinity;
        let bestTile = null;
        let minDistance = Infinity;

        const sortedAvailableTiles = tiles.sort((a, b) => {
            const distA = this.pathfinder.heuristic(currentX, currentY, a.x, a.y);
            const distB = this.pathfinder.heuristic(currentX, currentY, b.x, b.y);
            return distA - distB;
        });

        for (const tile of sortedAvailableTiles) {
            const key = `${tile.x},${tile.y}`;
            if (bannedThisTurn.has(key)) continue;
            const visits = this.explorationMap.get(key) || 0;
            const distance = this.pathfinder.heuristic(currentX, currentY, tile.x, tile.y);

            if (visits < minVisits) {
                minVisits = visits;
                bestTile = tile;
                minDistance = distance;
            } else if (visits === minVisits && distance < minDistance) {
                bestTile = tile;
                minDistance = distance;
            }
        }

        if (bestTile && !this.beliefs.isWalkable(bestTile.x, bestTile.y)) {
            const nearestValid = this.pathfinder.findNearestValidTile(bestTile.x, bestTile.y);
            return nearestValid || null;
        }

        return bestTile;
    }

    recordPosition(x, y) {
        const key = `${x},${y}`;
        this.explorationMap.set(key, (this.explorationMap.get(key) || 0) + 1);
    }

    clearPath() {
        this.explorationPath = [];
    }

    hasPath() {
        return this.explorationPath.length > 0;
    }

    isPathLeadingTo(targetX, targetY) {
        if (this.explorationPath.length === 0) return false;
        const finalStep = this.explorationPath[this.explorationPath.length - 1];
        return finalStep.x === targetX && finalStep.y === targetY;
    }

    setPath(path) {
        this.explorationPath = path;
    }

    getNextStep() {
        return this.explorationPath.length > 0 ? this.explorationPath[0] : null;
    }

    removeNextStep() {
        this.explorationPath.shift();
    }

    banTile(x, y) {
        const tileKey = `${x},${y}`;
        this.bannedExplorationTiles.set(tileKey, this.currentTurn + BAN_DURATION);
    }

    findSimpleValidMove(currentX, currentY) {
        for (const dir of DIRECTIONS) {
            const nextX = currentX + dir.dx;
            const nextY = currentY + dir.dy;
            if (this.beliefs.isWalkable(nextX, nextY)) {
                return { action: dir.action };
            }
        }
        return null;
    }
}