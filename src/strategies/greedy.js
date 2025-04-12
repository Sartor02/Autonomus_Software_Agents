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

        // Default: spiral pattern from edges inward
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
            return { ...dir, score: withinBounds ? -visits : -Infinity };
        }).sort((a, b) => b.score - a.score);
    
        for (const dir of scoredDirections) {
            const targetX = currentPos.x + dir.dx;
            const targetY = currentPos.y + dir.dy;
            if (dir.score > -Infinity && this.isValidMove(targetX, targetY)) {
                return { action: dir.action };
            }
        }
    
        // Fallback within bounds
        const fallback = directions.find(dir => {
            const tx = currentPos.x + dir.dx;
            const ty = currentPos.y + dir.dy;
            return (
                tx >= minX && tx <= maxX &&
                ty >= minY && ty <= maxY &&
                this.isValidMove(tx, ty)
            );
        });
    
        if (fallback) {
            return { action: fallback.action };
        }
    
        // Final fallback (any valid direction)
        return { action: directions[Math.floor(Math.random() * directions.length)].action };
    }
    

    // Helper methods
    calculatePathTo(targetTile) {
        const path = [];
        let current = { ...this.beliefs.myPosition };
        
        while (!this.isAtPosition(current.x, current.y, targetTile.x, targetTile.y)) {
            const dx = Math.sign(targetTile.x - current.x);
            const dy = Math.sign(targetTile.y - current.y);
            
            if (dx !== 0 && this.isValidMove(current.x + dx, current.y)) {
                current.x += dx;
            } else if (dy !== 0 && this.isValidMove(current.x, current.y + dy)) {
                current.y += dy;
            } else {
                break; // Path blocked
            }
            
            path.push({ ...current });
        }
        
        return path;
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
        return this.beliefs.normalTiles.some(t => t.x === x && t.y === y) ||
               this.beliefs.spawnTiles.some(t => t.x === x && t.y === y);
    }

    isAtPosition(x1, y1, x2, y2) {
        if (x2 === undefined || y2 === undefined) {
            const current = this.beliefs.myPosition;
            return Math.floor(current.x) === x1 && Math.floor(current.y) === y1;
        }
        return x1 === x2 && y1 === y2;
    }
}
