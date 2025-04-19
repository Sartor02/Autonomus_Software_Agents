export class GreedyStrategy {
    constructor(beliefs, deliveryStrategy, pathfinder) {
        this.beliefs = beliefs;
        this.deliveryStrategy = deliveryStrategy;
        this.pathfinder = pathfinder; // Use the new pathfinder

        this.explorationMap = new Map(); // {x,y}: count of times visited
        this.explorationPath = []; // Path calculated by A*

        this.stuckCounter = 0;
        this.lastPosition = null;
    }

    selectBestParcel() {
        if (!this.beliefs.availableParcels.length) return null;

        return this.beliefs.availableParcels
            .map(p => ({
                ...p,
                // Use beliefs.calculateDistance which uses current position
                efficiency: this.calculateParcelEfficiency(p)
            }))
            .sort((a, b) => b.efficiency - a.efficiency)[0];
    }

    calculateParcelEfficiency(parcel) {
        // Ensure distance is calculated from the agent's current position
        if (!this.beliefs.myPosition) return -Infinity; // Cannot calculate if position is unknown

        // We use Manhattan distance as the heuristic in A*, so it's consistent.
        const distance = this.beliefs.calculateDistance(parcel.x, parcel.y);

        // Ensure originalReward is not zero or null to prevent division errors
        const originalReward = parcel.originalReward > 0 ? parcel.originalReward : 100;
        const timeFactor = parcel.reward / originalReward;

        // Avoid division by zero if distance is 0
        return (parcel.reward * timeFactor) / (distance + 1); // Add 1 to distance
    }

    getAction() {
        const currentPos = this.beliefs.myPosition;
        if (!currentPos) {
             console.log("Agent position unknown, waiting...");
             return null; // Cannot act if position is unknown
        }

        // Detect if stuck (optional but helpful)
         if (this.lastPosition && this.isAtPosition(this.lastPosition.x, this.lastPosition.y, currentPos.x, currentPos.y)) {
            this.stuckCounter++;
            if (this.stuckCounter > 5) { // Stuck for 5 turns
                 console.warn("Agent seems stuck, clearing path and trying exploration.");
                 this.explorationPath = []; // Clear path to force recalculation
                 this.stuckCounter = 0;
            }
         } else {
             this.stuckCounter = 0;
         }
         this.lastPosition = { ...currentPos };


        // 1. Delivery priority
        const deliveryAction = this.deliveryStrategy.getDeliveryAction();
        if (deliveryAction) {
             if (deliveryAction.action.startsWith('move')) {
                  return deliveryAction;
             }
            return deliveryAction; // putdown or pickup during detour
        }

        // 2. Parcel collection
        const bestParcel = this.selectBestParcel();
        if (bestParcel) {
            // Check if we are at the parcel's exact location
            if (this.isAtPosition(bestParcel.x, bestParcel.y, currentPos.x, currentPos.y)) {
                return { action: 'pickup', target: bestParcel.id };
            }
            // If not at the parcel, calculate path to it and move
            console.log(`Targeting parcel at ${bestParcel.x}, ${bestParcel.y}`);
            // Calculate the path using the pathfinder only if the current path is empty or doesn't lead here
            if (this.explorationPath.length === 0 || !this.isPathLeadingTo(this.explorationPath, bestParcel.x, bestParcel.y)) {
                 this.explorationPath = this.pathfinder.findPath(currentPos.x, currentPos.y, bestParcel.x, bestParcel.y);
                 console.log(`Calculated new path to parcel: ${this.explorationPath.length} steps.`);
            }
             // Follow the calculated path
             return this.followExplorationPath(currentPos.x, currentPos.y);

        }

        // 3. Optimized exploration using Pathfinder
        if (this.explorationPath.length === 0) {
             console.log("No parcel or delivery target, starting exploration...");
            const explorationTarget = this.findExplorationTargetTile(currentPos.x, currentPos.y);
            if (explorationTarget) {
                console.log(`Exploration target found: ${explorationTarget.x}, ${explorationTarget.y}`);
                this.explorationPath = this.pathfinder.findPath(currentPos.x, currentPos.y, explorationTarget.x, explorationTarget.y);
                console.log(`Calculated exploration path: ${this.explorationPath.length} steps.`);
            } else {
                 console.warn("Could not find an exploration target tile.");
                 // Fallback if no exploration target is found (e.g., map fully explored or stuck)
                  const simpleMove = this.findSimpleValidMove(currentPos.x, currentPos.y);
                  if (simpleMove) {
                      console.log("Falling back to simple valid move.");
                      return simpleMove;
                  }
                  console.error("No exploration target, no simple valid move. Agent is likely stuck or map explored.");
                  return null; // Cannot move
            }
        }

        // Follow the exploration path if one exists
         return this.followExplorationPath(currentPos.x, currentPos.y);
    }

    // Find the least visited walkable tile as an exploration target
    findExplorationTargetTile(currentX, currentY) {
        const walkableTiles = this.beliefs.getAllWalkableTiles();
        if (walkableTiles.length === 0) {
            console.warn("No walkable tiles known for exploration.");
            return null;
        }

        let minVisits = Infinity;
        let bestTile = null;
        let minDistance = Infinity; // Break ties by distance

        // Prioritize nearby less-visited tiles
        // Sort tiles by distance first to bias towards closer ones with same visit count
        const sortedWalkableTiles = walkableTiles.sort((a, b) => {
             const distA = this.pathfinder.heuristic(currentX, currentY, a.x, a.y);
             const distB = this.pathfinder.heuristic(currentX, currentY, b.x, b.y);
             return distA - distB;
        });

        for (const tile of sortedWalkableTiles) {
            const key = `${tile.x},${tile.y}`;
            const visits = this.explorationMap.get(key) || 0;
            const distance = this.pathfinder.heuristic(currentX, currentY, tile.x, tile.y);


            // Criteria: less visited, or same visits but closer
            if (visits < minVisits) {
                minVisits = visits;
                bestTile = tile;
                minDistance = distance;
            } else if (visits === minVisits && distance < minDistance) {
                 bestTile = tile;
                 minDistance = distance;
            }
        }
        return bestTile;
    }


    followExplorationPath(currentX, currentY) {
        if (this.explorationPath.length === 0) {
            return null; // No path to follow
        }

        const nextStep = this.explorationPath[0]; // Get the next step in the path
        const action = this.pathfinder.getActionToNextStep(currentX, currentY, nextStep.x, nextStep.y);

        if (action) {
            // Record the tile we are moving *to* as visited.
            this.recordPosition(nextStep.x, nextStep.y);
            this.explorationPath.shift(); // Remove the step we are about to take
            return { action: action };
        } else {
            console.error(`Could not determine action for step ${currentX},${currentY} -> ${nextStep.x},${nextStep.y}. Clearing path.`);
            this.explorationPath = []; // Clear the path if something is wrong
            return null;
        }
    }

     // Helper to check if the current path is leading to a specific target
     isPathLeadingTo(path, targetX, targetY) {
         if (path.length === 0) return false;
         const finalStep = path[path.length - 1];
         return finalStep.x === targetX && finalStep.y === targetY;
     }


    recordPosition(x, y) {
        const key = `${x},${y}`;
        this.explorationMap.set(key, (this.explorationMap.get(key) || 0) + 1);
    }

     // Simple fallback move finding (should rarely be needed with Pathfinder)
    findSimpleValidMove(currentX, currentY) {
         const directions = [
            { dx: 0, dy: 1, action: 'move_up' },
            { dx: 0, dy: -1, action: 'move_down' },
            { dx: 1, dy: 0, action: 'move_right' },
            { dx: -1, dy: 0, action: 'move_left' },
        ];
        for (const dir of directions) {
            const nextX = currentX + dir.dx;
            const nextY = currentY + dir.dy;
            if (this.beliefs.isWalkable(nextX, nextY)) {
                return { action: dir.action };
            }
        }
        return null; // No valid move
    }

    isAtPosition(x1, y1, x2, y2) {
        return x1 === x2 && y1 === y2;
    }
}