// strategies/greedy.js

export class GreedyStrategy {
    constructor(beliefs, deliveryStrategy, pathfinder) {
        this.beliefs = beliefs;
        this.deliveryStrategy = deliveryStrategy;
        this.pathfinder = pathfinder;

        this.explorationMap = new Map(); // {x,y}: count of times visited
        this.explorationPath = []; // Path calculated by A*

        // Variables to manage being blocked by other agents on the next step
        this.blockedTargetTile = null; // The target tile of the step that was blocked
        this.blockedCounter = 0;       // How many consecutive turns we have been blocked trying to reach blockedTargetTile
        this.BLOCKED_TIMEOUT = 2;      // Threshold: after BLOCKED_TIMEOUT turns blocked on the same target tile, recalculate path

        // Stuck detection based on agent position not changing
        this.stuckCounter = 0;
        this.lastPosition = null;
        this.STUCK_TIMEOUT = 5; // Threshold: if agent position doesn't change for STUCK_TIMEOUT turns, clear path

        // Ban list for parcels blocked by other agents OR where pathfinding failed
        this.bannedParcels = new Map(); // Map<parcelId: string, banUntilTurn: number>
        this.currentTurn = 0; // Track turns to manage bans
        this.BAN_DURATION = 10; // How many turns to ban a blocked/unreachable parcel
    }

    // Helper method to check if a tile is currently blocked by another agent
    isBlockedByOtherAgent(x, y) {
        if (!this.beliefs.myId || !this.beliefs.agents) return false;
        // Check if any agent OTHER than me is at the specified coordinates (integer position)
        return this.beliefs.agents.some(agent =>
            agent.id !== this.beliefs.myId &&
            Math.floor(agent.x) === x &&
            Math.floor(agent.y) === y
        );
    }


    selectBestParcel() {
        const now = this.currentTurn;
        const bannedIdsToRemove = [];

        for (const [parcelId, banUntilTurn] of this.bannedParcels.entries()) {
             // Check if the ban has expired
            if (now >= banUntilTurn) {
                // console.log(`Ban for parcel ${parcelId} expired.`);
                bannedIdsToRemove.push(parcelId);
            } else {
                // Check if the parcel still exists in beliefs (it might have been taken by someone else or despawned)
                // Using beliefs.parcels is more robust than availableParcels as it includes carried ones
                const parcelExists = this.beliefs.parcels.some(p => p.id === parcelId);
                if (!parcelExists) {
                    bannedIdsToRemove.push(parcelId);
                }
            }
        }

        // Remove the identified bans
        bannedIdsToRemove.forEach(id => this.bannedParcels.delete(id));

        // Filter out parcels that are currently banned
        const availableAndNotBanned = this.beliefs.availableParcels.filter(p => !this.bannedParcels.has(p.id));

        if (!availableAndNotBanned.length) return null;

        // Sort the remaining available and non-banned parcels by efficiency
        return availableAndNotBanned
            .map(p => ({
                ...p,
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
        // Increment turn counter at the start of each action cycle
        this.currentTurn++;

        const currentPos = this.beliefs.myPosition;
        if (!currentPos) {
            // console.log("Agent position unknown, waiting...");
            return null; // Cannot act if position is unknown
        }

        // Detect if stuck (position hasn't changed)
         if (this.lastPosition && this.isAtPosition(this.lastPosition.x, this.lastPosition.y, currentPos.x, currentPos.y)) {
            this.stuckCounter++;
            if (this.stuckCounter > this.STUCK_TIMEOUT) {
                console.warn(`Agent's position hasn't changed for ${this.STUCK_TIMEOUT} turns. Clearing path and trying exploration.`);
                this.explorationPath = []; // Clear path to force recalculation
                // Also reset agent blocking state, as this might be the cause
                this.blockedTargetTile = null;
                this.blockedCounter = 0;
                this.stuckCounter = 0; // Reset self-stuck counter
            }
         } else {
            this.stuckCounter = 0; // Reset if position changed
         }
         this.lastPosition = { ...currentPos }; // Update last position


        // 1. Delivery priority
        // The DeliveryStrategy will now use the Pathfinder internally
        const deliveryAction = this.deliveryStrategy.getDeliveryAction();
        if (deliveryAction) {
            // If DeliveryStrategy provided an action (move, pickup, putdown)
            // Reset exploration blocking state if we are doing something else
            this.blockedTargetTile = null;
            this.blockedCounter = 0;
            return deliveryAction;
        }

        // 2. Parcel collection
        let bestParcel = this.selectBestParcel(); // Select the best parcel based on efficiency and ban list

        // Check if the best parcel exists AND its location is currently occupied by another agent
        if (bestParcel && this.isBlockedByOtherAgent(bestParcel.x, bestParcel.y)) {
            console.log(`Best parcel ${bestParcel.id} at ${bestParcel.x},${bestParcel.y} is blocked by another agent. Banning this parcel until turn ${this.currentTurn + this.BAN_DURATION}.`);
            // Add the parcel ID to the ban list with an expiry turn
            this.bannedParcels.set(bestParcel.id, this.currentTurn + this.BAN_DURATION);
            bestParcel = null; // Treat as if no best parcel was found, fall through to exploration
            // No need to clear explorationPath yet, maybe another parcel is available or we explore.
            // Reset exploration blocking state if we are ignoring the target
            this.blockedTargetTile = null;
            this.blockedCounter = 0;
            // Return null here to re-evaluate in the next turn, maybe another parcel becomes best.
            return null;
        }


        if (bestParcel) {
            // Check if we are at the parcel's exact location
            if (this.isAtPosition(bestParcel.x, bestParcel.y, currentPos.x, currentPos.y)) {
                // Reset exploration blocking state if we reached the target
                this.blockedTargetTile = null;
                this.blockedCounter = 0;
                return { action: 'pickup', target: bestParcel.id };
            }

            // If not at the parcel, calculate path to it and move
            // Recalculate path only if not already following one towards this parcel
            if (this.explorationPath.length === 0 || !this.isPathLeadingTo(this.explorationPath, bestParcel.x, bestParcel.y)) {
                console.log(`Targeting parcel at ${bestParcel.x}, ${bestParcel.y}. Calculating path.`);
                // Reset exploration blocking state before calculating a new path
                this.blockedTargetTile = null;
                this.blockedCounter = 0;

                this.explorationPath = this.pathfinder.findPath(currentPos.x, currentPos.y, bestParcel.x, bestParcel.y);
                console.log(`Calculated path to parcel: ${this.explorationPath.length} steps.`);

                // Handle case where pathfinding returns 0 steps but we are not at the target 
                if (this.explorationPath.length === 0 && !this.isAtPosition(bestParcel.x, bestParcel.y, currentPos.x, currentPos.y)) {
                    console.warn(`Pathfinder returned 0 steps to parcel ${bestParcel.id} at ${bestParcel.x},${bestParcel.y} which is not current position. Target likely unreachable (static obstacle or dynamic block). Banning parcel until turn ${this.currentTurn + this.BAN_DURATION}. Clearing path.`);
                    // Add the parcel ID to the ban list with an expiry turn because pathfinding failed
                    this.bannedParcels.set(bestParcel.id, this.currentTurn + this.BAN_DURATION);
                    // The next act cycle might find a new parcel (if not banned) or go to exploration.
                    // blockedTargetTile and blockedCounter were already reset above.
                    return null; // Do not attempt to follow an empty path
                }
            }
             // Follow the calculated path (or the one already being followed towards the parcel)
             return this.followExplorationPath(currentPos.x, currentPos.y);

        }

        // 3. Optimized exploration using Pathfinder
        // If no parcel target (either none existed, the best one was blocked/banned, or pathfinding failed), start exploration
        // If no path is being followed for exploration, find a new exploration target
        if (this.explorationPath.length === 0) {
             console.log("No parcel or delivery target, starting exploration...");
             // Reset exploration blocking state before finding a new target
             this.blockedTargetTile = null;
             this.blockedCounter = 0;

            // Find a walkable exploration target tile
            const explorationTarget = this.findExplorationTargetTile(currentPos.x, currentPos.y);

            if (explorationTarget) {
                console.log(`Exploration target found: ${explorationTarget.x}, ${explorationTarget.y}`);

                // Calculate the path towards the exploration target
                this.explorationPath = this.pathfinder.findPath(currentPos.x, currentPos.y, explorationTarget.x, explorationTarget.y);
                console.log(`Calculated exploration path: ${this.explorationPath.length} steps.`);

                // Handle case where pathfinding returns 0 steps but we are not at the target
                if (this.explorationPath.length === 0 && !this.isAtPosition(explorationTarget.x, explorationTarget.y, currentPos.x, currentPos.y)) {
                    console.warn(`Pathfinder returned 0 steps to exploration target ${explorationTarget.x},${explorationTarget.y} which is not current position. Target likely unreachable (static obstacle or dynamic block). Clearing path and forcing new exploration target next turn.`);
                    // Clear the failed path and force finding a *new* target next cycle
                    this.explorationPath = [];
                    // blockedTargetTile and blockedCounter were already reset above.
                    // We don't ban exploration targets, just try a different one next time.
                    return null; // Do not attempt to follow an empty path
                }

            } else {
                 console.warn("Could not find an exploration target tile.");
                 // Fallback if no valid/reachable exploration target is found
                  const simpleMove = this.findSimpleValidMove(currentPos.x, currentPos.y);
                  if (simpleMove) {
                      console.log("Falling back to simple valid move.");
                      // If even a simple move isn't possible, the agent is truly stuck
                      return simpleMove;
                  }
                  console.error("No exploration target, no simple valid move. Agent is likely completely stuck or map explored.");
                   // Reset exploration blocking state if no action is possible
                  this.blockedTargetTile = null;
                  this.blockedCounter = 0;
                  return null; // No action possible
            }
        }

        // If we reached here, it means explorationPath.length > 0 (or was just set).
        // Follow the calculated path.
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
        let minDistance = Infinity;

        // Sort walkable tiles by distance to prioritize closer ones with same visit count
        const sortedWalkableTiles = walkableTiles.sort((a, b) => {
             const distA = this.pathfinder.heuristic(currentX, currentY, a.x, a.y);
             const distB = this.pathfinder.heuristic(currentX, currentY, b.x, b.y);
             return distA - distB;
        });

        for (const tile of sortedWalkableTiles) {
            const key = `${tile.x},${tile.y}`;
            const visits = this.explorationMap.get(key) || 0;
            const distance = this.pathfinder.heuristic(currentX, currentY, tile.x, tile.y);

            // Choose the least visited tile, or the closest in case of a tie
            if (visits < minVisits) {
                minVisits = visits;
                bestTile = tile;
                minDistance = distance;
            } else if (visits === minVisits && distance < minDistance) {
                 bestTile = tile;
                 minDistance = distance;
            }
        }

        // Sanity check: the found target tile should be walkable according to current beliefs
        // The pathfinder already checks this, but doing it here prevents giving an invalid target to the pathfinder in the first place.
        if (bestTile && !this.beliefs.isWalkable(bestTile.x, bestTile.y)) {
             console.warn(`findExplorationTargetTile selected potentially unwalkable tile ${bestTile.x},${bestTile.y}. Looking for nearest walkable tile instead.`);
             const nearestValid = this.pathfinder.findNearestValidTile(bestTile.x, bestTile.y);
             if (nearestValid) {
                  console.log(`Using nearest valid tile ${nearestValid.x},${nearestValid.y} as exploration target.`);
                  return nearestValid;
             } else {
                  console.error(`Could not find nearest valid tile for selected exploration target ${bestTile.x},${bestTile.y}. No valid exploration target found.`);
                  return null;
             }
        }

        return bestTile; // Return the least visited walkable tile (or closest among least visited)
    }


    followExplorationPath(currentX, currentY) {
        if (this.explorationPath.length === 0) {
            // If the path is empty, reset block state
            this.blockedTargetTile = null;
            this.blockedCounter = 0;
            return null; // No path to follow
        }

        const nextStep = this.explorationPath[0];
        const targetX = nextStep.x;
        const targetY = nextStep.y;

        // Check if the destination tile is blocked by another agent
        const isBlocked = this.isBlockedByOtherAgent(targetX, targetY); // Use the helper method

        if (isBlocked) {
            // Check if we are trying to reach the same blocked tile as last turn
            if (this.blockedTargetTile && this.blockedTargetTile.x === targetX && this.blockedTargetTile.y === targetY) {
                this.blockedCounter++;
                // console.log(`Exploration: Still blocked at ${targetX},${targetY}. Count: ${this.blockedCounter}`);

                if (this.blockedCounter >= this.BLOCKED_TIMEOUT) {
                    console.warn(`Exploration: Blocked by agent at ${targetX},${targetY} for ${this.BLOCKED_TIMEOUT} turns. Clearing path to recalculate.`);
                    this.explorationPath = []; // Clear the current path
                    this.blockedTargetTile = null; // Reset block state
                    this.blockedCounter = 0;
                    // The next call to getAction() will see explorationPath is empty and find a new target/path
                    return null; // Do not attempt to move this turn
                }
            } else {
                // Blocked on a new target tile, reset counter
                // console.log(`Exploration: Blocked at new tile ${targetX},${targetY}. Starting block counter.`);
                this.blockedTargetTile = { x: targetX, y: targetY };
                this.blockedCounter = 1;
            }

            // If blocked but timeout not reached, wait (return null)
            return null;
        } else {
             // If not blocked, reset block state
             this.blockedTargetTile = null;
             this.blockedCounter = 0;
        }


        // If not blocked, determine the move action
        const action = this.pathfinder.getActionToNextStep(currentX, currentY, targetX, targetY);

        if (action) {
            this.recordPosition(targetX, targetY); // Record visit only if we are moving there
            this.explorationPath.shift(); // Remove the step only if we are about to take it
            return { action: action };
        } else {
            console.error(`Exploration: Could not determine action for step ${currentX},${currentY} -> ${targetX},${targetY}. Clearing path.`);
            this.explorationPath = [];
            this.blockedTargetTile = null; // Reset block state
            this.blockedCounter = 0;
            return null;
        }
    }

    // Helper to check if the current path is leading to a specific target
    isPathLeadingTo(path, targetX, targetY) {
        if (path.length === 0) return false;
        // The last node in the path array is the final target tile
        const finalStep = path[path.length - 1];
        return finalStep.x === targetX && finalStep.y === targetY;
    }


    recordPosition(x, y) {
        const key = `${x},${y}`;
        this.explorationMap.set(key, (this.explorationMap.get(key) || 0) + 1);
    }

    // Simple fallback move finding
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
            // Use beliefs.isWalkable which considers both static and dynamic obstacles (other agents)
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