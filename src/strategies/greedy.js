export class GreedyStrategy {
    constructor(beliefs, deliveryStrategy) {
        this.beliefs = beliefs;
        this.deliveryStrategy = deliveryStrategy;
        this.explorationMap = new Map(); // {x,y}: count
        this.positionHistory = []; // Last positions
        this.explorationPath = []; // Exploration path
        this.VISION = 5; // FIXME: Try to understand how to get it (AGENT_OBSERVATION_DISTANCE)
    }

    selectBestParcel() {
        if (!this.beliefs.availableParcels.length) return null;
        
        return this.beliefs.availableParcels
            .map(p => ({
                ...p,
                efficiency: this.calculateParcelEfficiency(p)
            }))
            .sort((a, b) => b.efficiency - a.efficiency)[0];
    }

    calculateParcelEfficiency(parcel) {
        const distance = this.beliefs.calculateDistance(parcel.x, parcel.y);
        const timeFactor = parcel.reward / (parcel.originalReward || 100);
        return (parcel.reward * timeFactor) / (distance + 0.1);
    }

    getAction() {
        // 1. Delivery priority
        const deliveryAction = this.deliveryStrategy.getDeliveryAction();
        if (deliveryAction) return deliveryAction;

        // 2. Parcel collection
        const bestParcel = this.selectBestParcel();
        if (bestParcel) {
            if (this.isAtPosition(bestParcel.x, bestParcel.y)) {
                return { action: 'pickup', target: bestParcel.id };
            }
            return this.calculateMoveTowards(bestParcel.x, bestParcel.y);
        }

        // 3. Optimized exploration
        return this.smartExplore();
    }

    calculateMoveTowards(targetX, targetY) {
        // Create a target object for calculatePathTo
        const targetTile = { x: targetX, y: targetY };
        console.log(`Calculating path to ${targetX}, ${targetY}`);

        // Calculate the path
        this.explorationPath = this.calculatePathTo(targetTile);

        // Perform the first step of the path (or handle empty/failed path)
        return this.followExplorationPath();
    }

    smartExplore() {
        // Use the exploration path if it exists
        if (this.explorationPath.length > 0) {
            return this.followExplorationPath();
        }

        // Look for the least explored spawn tiles
        const targetTile = this.findLeastExploredSpawnTile();
        if (targetTile) {
            this.explorationPath = this.calculatePathTo(targetTile);
            return this.followExplorationPath();
        }

        // If no path is available, fallback to a valid tile
        let current = { ...this.beliefs.myPosition };
        const validTile = this.findNearestValidTile(current);
        if (validTile) {
            return this.calculateMoveTowards(validTile.x, validTile.y);
        } 

        // Fallback to spiral exploration if no valid tile is found
        console.log('No valid tile found, falling back to spiral exploration');
        return this.spiralExploration();
    }

    findLeastExploredSpawnTile() {
        let minVisits = Infinity;
        let bestTile = null;
    
        const minX = this.VISION - 1;
        const minY = this.VISION - 1;
        const maxX = this.beliefs.mapWidth - this.VISION;
        const maxY = this.beliefs.mapHeight - this.VISION;
    
        for (const tile of this.beliefs.spawnTiles) {
            if (tile.x < minX || tile.x > maxX || tile.y < minY || tile.y > maxY) continue;
    
            const visits = this.explorationMap.get(`${tile.x},${tile.y}`) || 0;
            if (visits < minVisits) {
                minVisits = visits;
                bestTile = tile;
            }
        }
        console.log(`Best spawn tile: ${bestTile.x}, ${bestTile.y} with ${minVisits} visits`);
    
        return bestTile;
    }
    

    spiralExploration() {
        const currentPos = this.beliefs.myPosition;
        const minX = this.VISION - 1;
        const minY = this.VISION - 1;
        const maxX = this.beliefs.mapWidth - this.VISION;
        const maxY = this.beliefs.mapHeight - this.VISION;
    
        const directions = [
            { dx: 1, dy: 0, action: 'move_right' },
            { dx: 0, dy: 1, action: 'move_up' },
            { dx: -1, dy: 0, action: 'move_left' },
            { dx: 0, dy: -1, action: 'move_down' }
        ];
    
        const scoredDirections = directions.map(dir => {
            const targetX = currentPos.x + dir.dx;
            const targetY = currentPos.y + dir.dy;
    
            const withinBounds = (
                targetX >= minX &&
                targetX <= maxX &&
                targetY >= minY &&
                targetY <= maxY
            );

            const visits = this.explorationMap.get(`${targetX},${targetY}`) || 0;
            const isValid = this.isValidMove(targetX, targetY);
            return { ...dir, score: withinBounds && isValid ? -visits : -Infinity };
        }).sort((a, b) => b.score - a.score);

        for (const dir of scoredDirections) {
            if (dir.score > -Infinity) {
                return { action: dir.action };
            }
        }

        // Fallback: find any valid move
        const fallback = directions.find(dir => {
            const tx = currentPos.x + dir.dx;
            const ty = currentPos.y + dir.dy;
            return this.isValidMove(tx, ty);
        });

        if (fallback) {
            return { action: fallback.action };
        }

        // Last resort: stay in place or return null
        return null;
    }
    

    // Helper methods
    calculatePathTo(targetTile) {
        const path = [];
        let current = { ...this.beliefs.myPosition };

        while (!this.isAtPosition(current.x, current.y, targetTile.x, targetTile.y)) {
            const dx = Math.sign(targetTile.x - current.x);
            const dy = Math.sign(targetTile.y - current.y);

            let moved = false;

            if (dx !== 0 && this.isValidMove(current.x + dx, current.y)) {
                current.x += dx;
                moved = true;
            } else if (dy !== 0 && this.isValidMove(current.x, current.y + dy)) {
                current.y += dy;
                moved = true;
            }

            if (moved) {
                path.push({ ...current });
            } else {
                // No valid moves available, find the nearest valid tile
                const validTile = this.findNearestValidTile(current);
                if (validTile) {
                    targetTile = validTile; // Update target to the nearest valid tile
                } else {
                    break; // No valid tiles found, stop the path calculation
                }
            }
        }

        return path;
    }

    findNearestValidTile(start) {
        const directions = [
            { dx: 1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 },
            { dx: 0, dy: -1 }
        ];

        const queue = [start];
        const visited = new Set();
        visited.add(`${start.x},${start.y}`);

        while (queue.length > 0) {
            const current = queue.shift();

            for (const dir of directions) {
                const nextX = current.x + dir.dx;
                const nextY = current.y + dir.dy;
                const key = `${nextX},${nextY}`;

                if (!visited.has(key)) {
                    visited.add(key);

                    if (this.isValidMove(nextX, nextY)) {
                        return { x: nextX, y: nextY };
                    }

                    queue.push({ x: nextX, y: nextY });
                }
            }
        }

        return null; // No valid tile found
    }

    followExplorationPath() {
        if (this.explorationPath.length === 0) return null;
        
        const nextStep = this.explorationPath.shift();
        this.recordPosition(nextStep.x, nextStep.y);
        return { action: this.getDirectionTo(nextStep.x, nextStep.y) };
    }

    getDirectionTo(targetX, targetY) {
        const current = this.beliefs.myPosition;
        const dx = targetX - current.x;
        const dy = targetY - current.y;
        
        if (Math.abs(dx) > Math.abs(dy)) {
            return dx > 0 ? 'move_right' : 'move_left';
        } else {
            return dy > 0 ? 'move_up' : 'move_down';
        }
    }

    recordPosition(x, y) {
        const key = `${x},${y}`;
        this.explorationMap.set(key, (this.explorationMap.get(key) || 0) + 1);
        this.positionHistory.push({x, y});
        if (this.positionHistory.length > 5) this.positionHistory.shift();
    }

    isValidMove(x, y) {
        return this.beliefs.isWalkable(x, y) &&
               (this.beliefs.normalTiles.some(t => t.x === x && t.y === y) ||
                this.beliefs.spawnTiles.some(t => t.x === x && t.y === y));
    }

    isAtPosition(x1, y1, x2, y2) {
        if (x2 === undefined || y2 === undefined) {
            const current = this.beliefs.myPosition;
            return Math.floor(current.x) === x1 && Math.floor(current.y) === y1;
        }
        return x1 === x2 && y1 === y2;
    }
}
