import { Desires } from "../desires/desires.js";
import { 
    BLOCKED_TIMEOUT, 
    STUCK_TIMEOUT, 
    SPAWN_TILES_THRESHOLD,
    ACTIONS
} from "../utils/utils.js";
import { isAtPosition } from "../utils/utils.js";
import { HandoverCoordinator } from "../coordination/handover_coordinator.js";
import { ParcelSelector } from "./parcel_selector.js";
import { ExplorationManager } from "./exploration_manager.js";

export class Planner {
    constructor(beliefs, deliveryStrategy, pathfinder, announceIntentCallback = null) {
        this.beliefs = beliefs;
        this.deliveryStrategy = deliveryStrategy;
        this.pathfinder = pathfinder;
        this.desires = Desires;

        // Sub-components
        this.handoverCoordinator = new HandoverCoordinator(beliefs, pathfinder, announceIntentCallback);
        this.parcelSelector = new ParcelSelector(beliefs);
        this.explorationManager = new ExplorationManager(beliefs, pathfinder);

        // State management
        this.blockedTargetTile = null;
        this.blockedCounter = 0;
        this.stuckCounter = 0;
        this.lastPosition = null;
        this.activeExplorationDesire = null;
    }

    initializeMapKnowledge() {
        const spawnTiles = this.beliefs.spawnTiles;
        const normalTiles = this.beliefs.normalTiles;

        if (spawnTiles.length === 0 && normalTiles.length === 0) {
            console.warn("[Planner] Map knowledge is empty. Cannot determine exploration strategy.");
        }

        // TODO: Fix, Determine exploration strategy
        if (spawnTiles.length <= SPAWN_TILES_THRESHOLD) {
            this.activeExplorationDesire = this.desires.STRATEGY_CAMPER_SPAWN;
        } else if (normalTiles.length > 0 && spawnTiles.length > normalTiles.length) {
            this.activeExplorationDesire = this.desires.STRATEGY_FOCUS_SPAWN_EXPLORATION;
        } else {
            this.activeExplorationDesire = this.desires.STRATEGY_GENERAL_EXPLORATION;
        }

        console.log(`[Planner] Active exploration desire: ${this.activeExplorationDesire?.description}`);
    }

    setupHandoverIfNeeded() {
        this.handoverCoordinator.setupHandoverIfNeeded();
    }

    recordPosition(x, y) {
        this.explorationManager.recordPosition(x, y);
    }

    getAction() {
        // Increment turn counters
        this.parcelSelector.incrementTurn();
        this.explorationManager.incrementTurn();

        const currentPos = this.beliefs.myPosition;
        if (!currentPos) return null;

        // Check for handover mode first
        const handoverAction = this.handoverCoordinator.getHandoverAction();
        if (handoverAction) {
            this.resetBlockingState();
            return handoverAction;
        }

        // Handle stuck detection
        if (this.handleStuckDetection(currentPos)) return null;

        // 1. Delivery priority
        const deliveryAction = this.deliveryStrategy.getDeliveryAction();
        if (deliveryAction) {
            this.resetBlockingState();
            return deliveryAction;
        }

        // 2. Parcel collection
        this.parcelSelector.updateParcelTarget();
        let bestParcel = this.parcelSelector.getCurrentTarget();

        // Check if parcel is blocked
        if (bestParcel && this.isBlockedByOtherAgent(bestParcel.x, bestParcel.y)) {
            this.parcelSelector.banParcel(bestParcel.id);
            this.resetBlockingState();
            return null;
        }

        if (bestParcel) {
            return this.handleParcelCollection(bestParcel, currentPos);
        }

        // 3. Exploration
        return this.handleExploration(currentPos);
    }

    handleStuckDetection(currentPos) {
        if (this.lastPosition && isAtPosition(this.lastPosition.x, this.lastPosition.y, currentPos.x, currentPos.y)) {
            this.stuckCounter++;
            if (this.stuckCounter > STUCK_TIMEOUT) {
                console.warn(`Agent stuck for ${STUCK_TIMEOUT} turns. Clearing paths.`);
                this.explorationManager.clearPath();
                this.resetBlockingState();
                this.stuckCounter = 0;
                return true;
            }
        } else {
            this.stuckCounter = 0;
        }
        this.lastPosition = { ...currentPos };
        return false;
    }

    handleParcelCollection(bestParcel, currentPos) {
        if (isAtPosition(bestParcel.x, bestParcel.y, currentPos.x, currentPos.y)) {
            this.resetBlockingState();
            return { action: ACTIONS.PICKUP, target: bestParcel.id };
        }

        // Calculate path to parcel if needed
        if (!this.explorationManager.hasPath() || !this.explorationManager.isPathLeadingTo(bestParcel.x, bestParcel.y)) {
            this.resetBlockingState();
            const path = this.pathfinder.findPath(currentPos.x, currentPos.y, bestParcel.x, bestParcel.y);
            
            if (path.length === 0 && !isAtPosition(bestParcel.x, bestParcel.y, currentPos.x, currentPos.y)) {
                console.warn(`Cannot reach parcel ${bestParcel.id}. Banning.`);
                this.parcelSelector.banParcel(bestParcel.id);
                return null;
            }
            
            this.explorationManager.setPath(path);
        }

        return this.followPath(currentPos);
    }

    handleExploration(currentPos) {
        if (!this.explorationManager.hasPath()) {
            this.resetBlockingState();
            const explorationTarget = this.explorationManager.findExplorationTargetTile(currentPos.x, currentPos.y);
            
            if (explorationTarget) {
                const path = this.pathfinder.findPath(currentPos.x, currentPos.y, explorationTarget.x, explorationTarget.y);
                
                if (path.length === 0 && !isAtPosition(explorationTarget.x, explorationTarget.y, currentPos.x, currentPos.y)) {
                    this.explorationManager.banTile(explorationTarget.x, explorationTarget.y);
                    const simpleMove = this.explorationManager.findSimpleValidMove(currentPos.x, currentPos.y);
                    return simpleMove;
                }
                
                this.explorationManager.setPath(path);
            } else {
                const simpleMove = this.explorationManager.findSimpleValidMove(currentPos.x, currentPos.y);
                return simpleMove;
            }
        }

        return this.followPath(currentPos);
    }

    followPath(currentPos) {
        const nextStep = this.explorationManager.getNextStep();
        if (!nextStep) return null;

        const isBlocked = this.isBlockedByOtherAgent(nextStep.x, nextStep.y);

        if (isBlocked) {
            if (this.blockedTargetTile && this.blockedTargetTile.x === nextStep.x && this.blockedTargetTile.y === nextStep.y) {
                this.blockedCounter++;
                if (this.blockedCounter >= BLOCKED_TIMEOUT) {
                    console.warn(`Blocked for ${BLOCKED_TIMEOUT} turns. Clearing path.`);
                    this.explorationManager.clearPath();
                    this.resetBlockingState();
                    return null;
                }
            } else {
                this.blockedTargetTile = { x: nextStep.x, y: nextStep.y };
                this.blockedCounter = 1;
            }
            return null;
        } else {
            this.resetBlockingState();
        }

        const action = this.pathfinder.getActionToNextStep(currentPos.x, currentPos.y, nextStep.x, nextStep.y);
        if (action) {
            this.explorationManager.recordPosition(nextStep.x, nextStep.y);
            this.explorationManager.removeNextStep();
            return { action };
        } else {
            console.error(`Cannot determine action for step. Clearing path.`);
            this.explorationManager.clearPath();
            this.resetBlockingState();
            return null;
        }
    }

    resetBlockingState() {
        this.blockedTargetTile = null;
        this.blockedCounter = 0;
    }

    isBlockedByOtherAgent(x, y) {
        if (!this.beliefs.myId || !this.beliefs.agents) return false;
        return this.beliefs.agents.some(agent =>
            agent.id !== this.beliefs.myId &&
            Math.floor(agent.x) === x &&
            Math.floor(agent.y) === y
        );
    }
}