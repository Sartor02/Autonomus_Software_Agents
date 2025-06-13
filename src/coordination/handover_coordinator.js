import { ROLES, ACTIONS, DIRECTIONS } from "../utils/utils.js";
import { isAtPosition } from "../utils/utils.js";

export class HandoverCoordinator {
    constructor(beliefs, pathfinder, announceIntentCallback) {
        this.beliefs = beliefs;
        this.pathfinder = pathfinder;
        this.announceIntent = announceIntentCallback;
        
        // Handover state
        this.isHandoverMode = false;
        this.myRole = null;
        this.handoverTile = null;
        this.spawnTile = null;
        this.deliveryTile = null;
    }

    setupHandoverIfNeeded() {
        if (this.isHandoverMode) return;

        const spawnTiles = this.beliefs.getSpawnTiles() || [];
        const deliveryTiles = this.beliefs.getDeliveryTiles() || [];
        console.log(`[HandoverCoordinator] Checking setup: ${spawnTiles.length} spawn tiles, ${deliveryTiles.length} delivery tiles`);

        
        if (spawnTiles.length === 1 && deliveryTiles.length === 1) {
            this.initializeHandoverMode(spawnTiles[0], deliveryTiles[0]);
        }
    }

    initializeHandoverMode(spawnTile, deliveryTile) {
        this.isHandoverMode = true;
        this.spawnTile = spawnTile;
        this.deliveryTile = deliveryTile;
        
        // Calculate handover tile (midpoint of path)
        const path = this.pathfinder.findPath(spawnTile.x, spawnTile.y, deliveryTile.x, deliveryTile.y);
        this.handoverTile = path.length > 2 ? path[Math.floor(path.length / 2)] : (path[1] || spawnTile);        
        console.log(`[HandoverCoordinator] Handover mode enabled: Spawn(${spawnTile.x},${spawnTile.y}), Delivery(${deliveryTile.x},${deliveryTile.y}), Handover(${this.handoverTile.x},${this.handoverTile.y})`);

        this.assignInitialRole();
        this.announceRole();
    }

    assignInitialRole() {
        const myPosition = this.beliefs.myPosition;
        const myId = this.beliefs.myId;
        
        let myDist = Math.abs(myPosition.x - this.spawnTile.x) + Math.abs(myPosition.y - this.spawnTile.y);
        let minDist = myDist;
        let runnerId = myId;

        // Check other agents' initial positions
        if (this.beliefs.initialAgentPositions) {
            for (const [agentId, pos] of Object.entries(this.beliefs.initialAgentPositions)) {
                const d = Math.abs(pos.x - this.spawnTile.x) + Math.abs(pos.y - this.spawnTile.y);
                if (d < minDist || (d === minDist && agentId < runnerId)) {
                    minDist = d;
                    runnerId = agentId;
                }
            }
        }

        this.setRole(myId === runnerId ? ROLES.RUNNER : ROLES.CARRIER);
    }

    setRole(role) {
        this.myRole = role;
        console.log(`[HandoverCoordinator] Role assigned: ${this.myRole}`);
    }

    announceRole() {
        if (this.announceIntent) {
            this.announceIntent(null, null, this.myRole, this.handoverTile);
        }
    }

    handleRoleConflict() {
        if (!this.beliefs.agentRoles) return false;

        const otherAgents = Object.keys(this.beliefs.agentRoles).filter(id => id !== this.beliefs.myId);
        if (otherAgents.length === 0) return false;

        const otherId = otherAgents[0];
        const otherRole = this.beliefs.agentRoles[otherId];

        if (otherRole && otherRole === this.myRole) {
            console.log(`[HandoverCoordinator] Role conflict detected! My role: ${this.myRole}, Other role: ${otherRole}`);
            this.resolveRoleConflict(otherId);
            return true;
        }

        return false;
    }

    resolveRoleConflict(otherId) {
        const myInitPos = this.beliefs.initialAgentPositions?.[this.beliefs.myId] || this.beliefs.myPosition;
        const otherInitPos = this.beliefs.initialAgentPositions?.[otherId];

        let myDist = Infinity, otherDist = Infinity;
        
        if (myInitPos) myDist = Math.abs(myInitPos.x - this.spawnTile.x) + Math.abs(myInitPos.y - this.spawnTile.y);
        if (otherInitPos) otherDist = Math.abs(otherInitPos.x - this.spawnTile.x) + Math.abs(otherInitPos.y - this.spawnTile.y);

        const newRole = (myDist < otherDist || (myDist === otherDist && this.beliefs.myId < otherId)) ? ROLES.RUNNER : ROLES.CARRIER;
        
        this.setRole(newRole);
        this.announceRole();
    }

    // TODO: Refactor and remove second if
    getHandoverAction() {
        if (!this.isHandoverMode) return null;

        // Handle role conflicts first
        this.handleRoleConflict();

        if (this.myRole === ROLES.RUNNER) {
            return this.getRunnerAction();
        } else if (this.myRole === ROLES.CARRIER) {
            return this.getCarrierAction();
        }

        return null;
    }

    getRunnerAction() {
        const pos = this.beliefs.myPosition;
        console.log(`[HandoverCoordinator] Handovertile: ${this.handoverTile.y}, My Position: ${pos.x}, ${pos.y}`);
        if (!this.beliefs.hasParcel()) {
            // Go to spawn and pick up parcel
            if (pos.x === this.spawnTile.x && pos.y === this.spawnTile.y) {
                const parcel = this.beliefs.availableParcels.find(p => p.x === pos.x && p.y === pos.y);
                if (parcel) return { action: ACTIONS.PICKUP, target: parcel.id };
            }
            return this.moveTo(this.spawnTile.x, this.spawnTile.y);
        } else {
            // Transport to handover tile
            if (pos.x === this.handoverTile.x && pos.y === this.handoverTile.y) {
                if (this.canDropAtHandover()) {
                    return { action: ACTIONS.PUTDOWN };
                } else {
                    // Move away from handover tile
                    return this.moveToAdjacent(this.handoverTile.x, this.handoverTile.y) || 
                           this.moveTo(this.spawnTile.x, this.spawnTile.y);
                }
            } else {
                // Move to handover tile if it's free
                if (!this.isBlockedByOtherAgent(this.handoverTile.x, this.handoverTile.y)) {
                    return this.moveTo(this.handoverTile.x, this.handoverTile.y);
                } else {
                    return this.moveToAdjacent(this.handoverTile.x, this.handoverTile.y);
                }
            }
        }
    }

    getCarrierAction() {
        const pos = this.beliefs.myPosition;
        const parcelAtHandover = this.beliefs.availableParcels.find(
            p => p.x === this.handoverTile.x && p.y === this.handoverTile.y
        );

        if (!this.beliefs.hasParcel()) {
            if (parcelAtHandover) {
                // Pick up parcel at handover
                if (pos.x === this.handoverTile.x && pos.y === this.handoverTile.y) {
                    return { action: ACTIONS.PICKUP, target: parcelAtHandover.id };
                }
                // Move to handover if it's free
                if (!this.isBlockedByOtherAgent(this.handoverTile.x, this.handoverTile.y)) {
                    return this.moveTo(this.handoverTile.x, this.handoverTile.y);
                } else {
                    return this.moveToAdjacent(this.handoverTile.x, this.handoverTile.y);
                }
            } else {
                // Wait near handover tile
                if (pos.y === this.handoverTile.y + 1) {
                    return { action: ACTIONS.NONE};
                }
                return this.moveTo(this.handoverTile.x, this.handoverTile.y + 1);
            }
        } else {
            // Deliver parcel
            if (this.beliefs.isDeliveryTile(pos.x, pos.y)) {
                return { action: ACTIONS.PUTDOWN };
            }
            return this.moveTo(this.deliveryTile.x, this.deliveryTile.y);
        }
    }

    canDropAtHandover() {
        const alreadyParcel = this.beliefs.availableParcels.some(
            p => p.x === this.handoverTile.x && p.y === this.handoverTile.y
        );
        const pos = this.beliefs.myPosition;
        return !alreadyParcel && !this.isBlockedByOtherAgent(pos.x, pos.y);
    }

    isBlockedByOtherAgent(x, y) {
        if (!this.beliefs.myId || !this.beliefs.agents) return false;
        return this.beliefs.agents.some(agent =>
            agent.id !== this.beliefs.myId &&
            Math.floor(agent.x) === x &&
            Math.floor(agent.y) === y
        );
    }

    moveTo(targetX, targetY) {
        const currentPos = this.beliefs.myPosition;
        if (!currentPos) return null;
        
        if (isAtPosition(currentPos.x, currentPos.y, targetX, targetY)) return null;
        
        const path = this.pathfinder.findPath(currentPos.x, currentPos.y, targetX, targetY);
        if (path.length === 0) return null;
        
        const nextStep = path[0];
        const action = this.pathfinder.getActionToNextStep(currentPos.x, currentPos.y, nextStep.x, nextStep.y);
        
        return action ? { action } : null;
    }

    moveToAdjacent(targetX, targetY) {
        const pos = this.beliefs.myPosition;
        for (const dir of DIRECTIONS) {
            const nx = targetX + dir.dx;
            const ny = targetY + dir.dy;
            if (this.beliefs.isWalkable(nx, ny) && !(nx === pos.x && ny === pos.y)) {
                return this.moveTo(nx, ny);
            }
        }
        return null;
    }

    isRunner() {
        return this.myRole === ROLES.RUNNER;
    }

    isCarrier() {
        return this.myRole === ROLES.CARRIER;
    }
}