// strategies/greedy.js
import { Desires } from "../desires/desires.js";
import { BAN_DURATION, BLOCKED_TIMEOUT, CARRIER, DIRECTIONS, MIN_GENERAL_REWARD, NEARBY_DISTANCE_THRESHOLD, RUNNER, SPAWN_TILES_HIGH_FACTOR, SPAWN_TILES_THRESHOLD, STUCK_TIMEOUT, TARGET_LOST_THRESHOLD } from "../utils/utils.js";
import { isAtPosition } from "../utils/utils.js";

export class Planner {
    constructor(beliefs, deliveryStrategy, pathfinder, announceIntentCallback = null) {
        this.announceIntent = announceIntentCallback;
        this.beliefs = beliefs;
        this.deliveryStrategy = deliveryStrategy;
        this.pathfinder = pathfinder;
        this.desires = Desires;

        this.explorationMap = new Map(); // {x,y}: count of times visited
        this.explorationPath = []; // Path calculated by A*

        // Variables to manage being blocked by other agents on the next step
        this.blockedTargetTile = null; // The target tile of the step that was blocked
        this.blockedCounter = 0;       // How many consecutive turns we have been blocked trying to reach blockedTargetTile
        this.BLOCKED_TIMEOUT = BLOCKED_TIMEOUT;      // Threshold: after BLOCKED_TIMEOUT turns blocked on the same target tile, recalculate path

        // Stuck detection based on agent position not changing
        this.stuckCounter = 0;
        this.lastPosition = null;
        this.STUCK_TIMEOUT = STUCK_TIMEOUT; // Threshold: if agent position doesn't change for STUCK_TIMEOUT turns, clear path

        // Ban list for parcels blocked by other agents OR where pathfinding failed
        this.bannedParcels = new Map(); // Map<parcelId: string, banUntilTurn: number>
        this.bannedExplorationTiles = new Map(); // Map<"x,y": string, banUntilTurn: number>

        this.currentTurn = 0; // Track turns to manage bans (simulated turn counter)
        this.BAN_DURATION = BAN_DURATION; // How many turns to ban a blocked/unreachable parcel

        this.MIN_GENERAL_REWARD = MIN_GENERAL_REWARD; // Minimum reward for a parcel to be considered generally
        this.NEARBY_DISTANCE_THRESHOLD = NEARBY_DISTANCE_THRESHOLD; // Distance threshold for picking up low-reward parcels

        this.activeExplorationDesire = null; // Track the active exploration desire

        this.currentParcelTarget = null;
        this.targetLostTurns = 0;
        this.targetLostThreshold = TARGET_LOST_THRESHOLD // Numero di turni prima di cambiare target

        this.isHandoverMode = false;
        this.isRunner = false;
        this.isCarrier = false;
        this.handoverTile = null;
        this.spawnTile = null;
        this.deliveryTile = null;

    }

    initializeMapKnowledge() {
        const spawnTiles = this.beliefs.spawnTiles;
        const normalTiles = this.beliefs.normalTiles;

        if (spawnTiles.length === 0 && normalTiles.length === 0) {
            console.warn("[Planner] Beliefs: Map knowledge is empty. Cannot determine exploration strategy.");
        }

        if (spawnTiles.length <= SPAWN_TILES_THRESHOLD) { // If there are few spawn tiles
            this.activeExplorationDesire = this.desires.STRATEGY_CAMPER_SPAWN;
            console.log(`[Planner] Detected map with few spawn tiles (${spawnTiles.length}). Active desire: ${this.activeExplorationDesire.description}`);
        } else if (normalTiles.length > 0 && spawnTiles.length > normalTiles.length * SPAWN_TILES_HIGH_FACTOR) { // If spawn tiles are predominant
            this.activeExplorationDesire = this.desires.STRATEGY_FOCUS_SPAWN_EXPLORATION;
            console.log(`[Planner] Detected map with many spawn tiles (${spawnTiles.length}) compared to normal tiles (${normalTiles.length}). Active desire: ${this.activeExplorationDesire.description}`);
        } else { // In all other cases, including maps without normal tiles or with a normal balance
            this.activeExplorationDesire = this.desires.STRATEGY_GENERAL_EXPLORATION;
            console.log(`[Planner] Normal map or no specific pattern. Active desire: ${this.activeExplorationDesire.description}`);
        }
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
        const myId = this.beliefs.myId;
        const otherIntents = this.beliefs.getOtherAgentsIntents(myId);
        // *** Clean up expired or collected bans from the ban list (Parcels) ***
        const now = this.currentTurn;
        const bannedParcelIdsToRemove = [];

        for (const [parcelId, banUntilTurn] of this.bannedParcels.entries()) {
            // Check if the ban has expired
            if (now >= banUntilTurn) {
                // console.log(`Ban for parcel ${parcelId} expired.`);
                bannedParcelIdsToRemove.push(parcelId);
            } else {
                // Check if the parcel still exists in beliefs (it might have been taken by someone else or despawned)
                // Using beliefs.parcels is more robust than availableParcels as it includes carried ones
                const parcelExists = this.beliefs.parcels.some(p => p.id === parcelId);
                if (!parcelExists) {
                    // console.log(`Banned parcel ${parcelId} no longer exists in beliefs.`);
                    bannedParcelIdsToRemove.push(parcelId);
                }
            }
        }
        // Remove the identified bans
        bannedParcelIdsToRemove.forEach(id => this.bannedParcels.delete(id));
        // *** End cleanup Parcels ***


        // Filter out parcels that are currently banned
        let availableAndNotBanned = this.beliefs.availableParcels.filter(p => !this.bannedParcels.has(p.id));

        // --- AGGIUNTA: se sono runner in handover, ignora le parcel sulla handoverTile ---
        if (this.isHandoverMode && this.isRunner && this.handoverTile) {
            availableAndNotBanned = availableAndNotBanned.filter(
                p => !(p.x === this.handoverTile.x && p.y === this.handoverTile.y)
            );
        }

        if (!availableAndNotBanned.length) return null;

        let parcels = this.beliefs.availableParcels.filter(parcel => {
            // Escludi se un altro agente ha già come target questa parcella
            const inMyArea = !this.beliefs.myAssignedArea ||
                this.beliefs.myAssignedArea.some(tile => tile.x === parcel.x && tile.y === parcel.y);
            return inMyArea && !otherIntents.some(intent =>
                intent.target && intent.target.x === parcel.x && intent.target.y === parcel.y
            );
        });

        if (parcels.length === 0) {
            parcels = this.beliefs.availableParcels; // oppure filtra per aree vicine
        }

        const currentPos = this.beliefs.myPosition;
        if (!currentPos) return null; // Should be checked at the start of getAction

        if (this.activeExplorationDesire === this.desires.STRATEGY_CAMPER_SPAWN) {
            const spawnTiles = this.beliefs.spawnTiles;
            parcels = parcels.filter(p =>
                spawnTiles.some(st => st.x === p.x && st.y === p.y)
            );
            if (!parcels.length) {
                console.log("[Planner] STRATEGY_CAMPER_SPAWN active: No parcels on spawn tiles. Trying to find any parcel now, will resume camper mode later.");
                // Force exploration to find any parcel
                return null;
            }
        }

        let filteredByReward = availableAndNotBanned.filter(p => {
            const distanceToParcel = this.beliefs.calculateDistance(p.x, p.y);
            // Keep the parcel if its reward is >= MIN_GENERAL_REWARD
            // OR if it's within NEARBY_DISTANCE_THRESHOLD from the agent's current position
            return p.reward >= this.MIN_GENERAL_REWARD || distanceToParcel <= this.NEARBY_DISTANCE_THRESHOLD;
        });

        if (!filteredByReward.length) {
            // console.log("All available parcels filtered out by low reward or distance.");
            return null; // No suitable parcels after filtering
        }

        // Sort the remaining suitable parcels by efficiency (reward / distance to parcel)
        return filteredByReward
            .map(p => ({
                ...p,
                efficiency: this.calculateParcelEfficiency(p)
            }))
            .sort((a, b) => b.efficiency - a.efficiency)[0];
    }

    // calculateParcelEfficiency method remains the same from the provided base code
    calculateParcelEfficiency(parcel) {
        // Ensure distance is calculated from the agent's current position
        if (!this.beliefs.myPosition) return -Infinity; // Cannot calculate if position is unknown

        // We use Manhattan distance as the heuristic in A*, so it's consistent.
        const distance = this.beliefs.calculateDistance(parcel.x, parcel.y);

        // Ensure originalReward is not zero or null to prevent division errors
        const originalReward = parcel.originalReward > 0 ? parcel.originalReward : 100;
        const timeFactor = parcel.reward / originalReward; // Represents remaining value ratio

        // Avoid division by zero if distance is 0
        return (parcel.reward * timeFactor) / (distance + 1); // Add 1 to distance
    }

    getAction() {
        // Increment turn counter at the start of each action cycle
        this.currentTurn++;

        if (this.isHandoverMode) {
            const pos = this.beliefs.myPosition;

            // Debug: stampa i ruoli conosciuti
            //console.log(`[HANDOVER] Agent ${this.beliefs.myId} - My role: ${this.myRole}, Known roles:`, this.beliefs.agentRoles);

            if (this.beliefs.agentRoles) {
                const otherAgents = Object.keys(this.beliefs.agentRoles).filter(id => id !== this.beliefs.myId);
                if (otherAgents.length > 0) {
                    const otherId = otherAgents[0];
                    const otherRole = this.beliefs.agentRoles[otherId];

                    if (otherRole && otherRole === this.myRole) {
                        // Conflitto: entrambi runner o entrambi carrier
                        console.log(`[HANDOVER - AGENT ${this.beliefs.myId}] Conflitto rilevato! Io: ${this.myRole}, Altro: ${otherRole}`);

                        const myInitPos = this.beliefs.initialAgentPositions?.[this.beliefs.myId] || this.beliefs.myPosition;
                        const otherInitPos = this.beliefs.initialAgentPositions?.[otherId];
                        console.log(`[HANDOVER] Posizioni iniziali: Io=${myInitPos}, Altro=${otherInitPos}`);
                        let myDist = Infinity, otherDist = Infinity;
                        console.log(`[HANDOVER] Inizializzo distanze: myDist=${myDist}, otherDist=${otherDist}`);
                        if (myInitPos) myDist = Math.abs(myInitPos.x - this.spawnTile.x) + Math.abs(myInitPos.y - this.spawnTile.y);
                        if (otherInitPos) otherDist = Math.abs(otherInitPos.x - this.spawnTile.x) + Math.abs(otherInitPos.y - this.spawnTile.y);

                        console.log(`[HANDOVER] Distanze calcolate: myDist=${myDist}, otherDist=${otherDist}`);
                        if (myDist < otherDist || (myDist === otherDist && this.beliefs.myId < otherId)) {
                            this.isRunner = true;
                            this.isCarrier = false;
                            this.myRole = RUNNER;
                        } else {
                            this.isRunner = false;
                            this.isCarrier = true;
                            this.myRole = CARRIER;
                        }
                        console.log(`[HANDOVER] Ruolo aggiornato: ${this.myRole}`);

                        // Ri-annuncia il ruolo corretto
                        if (this.announceIntent) {
                            console.log(`[HANDOVER] Ri-annuncio ruolo: ${this.myRole}`);
                            this.announceIntent(null, null, this.myRole, this.handoverTile);
                        }
                    }
                }
            }
            if (this.isRunner) {
                if (!this.beliefs.hasParcel()) {
                    console.log(`[AGENT ${this.beliefs.myId} RUNNER] Runner without parcel, going to spawn or handover tile.`);
                    // Vai a spawn e prendi pacco
                    if (pos.x === this.spawnTile.x && pos.y === this.spawnTile.y) {
                        const parcel = this.beliefs.availableParcels.find(p => p.x === pos.x && p.y === pos.y);
                        if (parcel) return { action: 'pickup', target: parcel.id };
                    }
                    return this.moveTo(this.spawnTile.x, this.spawnTile.y);
                } else {
                    // Se sono sopra la handoverTile
                    if (pos.x === this.handoverTile.x && pos.y === this.handoverTile.y) {
                        // Metti giù solo se NON c'è già una parcella e il carrier NON è sopra
                        const alreadyParcel = this.beliefs.availableParcels.some(
                            p => p.x === this.handoverTile.x && p.y === this.handoverTile.y
                        );
                        if (!alreadyParcel && !this.isBlockedByOtherAgent(pos.x, pos.y)) {
                            if (!alreadyParcel && !this.isBlockedByOtherAgent(pos.x, pos.y)) {
                                // Dopo il putdown, resetta il target per evitare di riprenderla subito
                                this.currentParcelTarget = null;
                                this.targetLostTurns = 0;
                                return { action: 'putdown' };
                            }
                        } else {
                            // Allontanati subito dalla handoverTile (verso spawn)
                            return this.moveToAdjacent(this.handoverTile.x, this.handoverTile.y) || this.moveTo(this.spawnTile.x, this.spawnTile.y);
                        }
                    } else {
                        // Vai verso la handoverTile solo se libera
                        if (!this.isBlockedByOtherAgent(this.handoverTile.x, this.handoverTile.y)) {
                            return this.moveTo(this.handoverTile.x, this.handoverTile.y);
                        } else {
                            // Aspetta vicino
                            return this.moveToAdjacent(this.handoverTile.x, this.handoverTile.y);
                        }
                    }
                }
            }

            // --- CARRIER ---
            if (this.isCarrier) {
                console.log(`[AGENT ${this.beliefs.myId} CARRIER] Going to handover tile or delivery tile.`);
                const parcel = this.beliefs.availableParcels.find(
                    p => p.x === this.handoverTile.x && p.y === this.handoverTile.y
                );
                if (!this.beliefs.hasParcel()) {
                    if (parcel) {
                        // Se sono sopra la handoverTile, prendi la parcella
                        if (pos.x === this.handoverTile.x && pos.y === this.handoverTile.y) {
                            return { action: 'pickup', target: parcel.id };
                        }
                        // Avvicinati solo se la tile è libera
                        if (!this.isBlockedByOtherAgent(this.handoverTile.x, this.handoverTile.y)) {
                            return this.moveTo(this.handoverTile.x, this.handoverTile.y);
                        } else {
                            // Aspetta su una tile adiacente
                            return this.moveToAdjacent(this.handoverTile.x, this.handoverTile.y);
                        }
                    } else {
                        // Aspetta vicino alla handoverTile
                        if (pos.x === this.handoverTile.x && pos.y === this.handoverTile.y) {
                            // Se sopra la handoverTile ma non c'è pacco, spostati su una tile adiacente
                            return this.moveToAdjacent(this.handoverTile.x, this.handoverTile.y);
                        }
                        return this.moveTo(this.handoverTile.x, this.handoverTile.y);
                    }
                } else {
                    // Hai pacco: vai a delivery
                    if (this.beliefs.isDeliveryTile(pos.x, pos.y)) {
                        return { action: 'putdown' };
                    }
                    return this.moveTo(this.deliveryTile.x, this.deliveryTile.y);
                }
            }
        }

        // *** Clean up expired bans from the ban list (Exploration Tiles) ***
        const now = this.currentTurn;
        const bannedTileKeysToRemove = [];
        for (const [tileKey, banUntilTurn] of this.bannedExplorationTiles.entries()) {
            if (now >= banUntilTurn) {
                // console.log(`Ban for exploration tile ${tileKey} expired.`);
                bannedTileKeysToRemove.push(tileKey);
            }
        }
        bannedTileKeysToRemove.forEach(key => this.bannedExplorationTiles.delete(key));
        // *** End cleanup Exploration Tiles ***


        const currentPos = this.beliefs.myPosition;
        if (!currentPos) {
            // console.log("Agent position unknown, waiting...");
            return null; // Cannot act if position is unknown
        }

        // Detect if stuck (position hasn't changed)
        if (this.lastPosition && isAtPosition(this.lastPosition.x, this.lastPosition.y, currentPos.x, currentPos.y)) {
            this.stuckCounter++;
            if (this.stuckCounter > this.STUCK_TIMEOUT) {
                console.warn(`Agent's position hasn't changed for ${this.STUCK_TIMEOUT} turns. Clearing path and trying exploration.`);
                this.explorationPath = []; // Clear path to force re-decision
                // Also reset agent blocking state, as this might be the cause
                this.blockedTargetTile = null;
                this.blockedCounter = 0;
                this.stuckCounter = 0; // Reset self-stuck counter
                // Note: No need to clear banned lists here, they have their own expiry/cleanup
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
        // selectBestParcel will now return the best parcel >= MIN_GENERAL_REWARD or nearby, and not banned
        this.updateParcelTarget();
        let bestParcel = this.currentParcelTarget;

        // Check if the best parcel exists AND its location is currently occupied by another agent
        // Note: If bestParcel is null here, it means either no suitable parcels available (after reward/distance filter),
        // or the most efficient one(s) were filtered out by the ban list.
        if (bestParcel && this.isBlockedByOtherAgent(bestParcel.x, bestParcel.y)) {
            console.log(`Best parcel ${bestParcel.id} at ${bestParcel.x},${bestParcel.y} is blocked by another agent. Banning this parcel until turn ${this.currentTurn + this.BAN_DURATION}.`);
            // Add the parcel ID to the ban list with an expiry turn
            this.bannedParcels.set(bestParcel.id, this.currentTurn + this.BAN_DURATION);
            bestParcel = null; // Treat as if no suitable parcel was found, fall through to exploration
            // Reset exploration blocking state if we are ignoring the target
            this.blockedTargetTile = null;
            this.blockedCounter = 0;
            // Return null here to re-evaluate in the next turn, maybe another suitable parcel becomes best.
            return null;
        }


        if (bestParcel) {
            // If we have a valid, non-blocked, suitable best parcel target

            // Check if we are at the parcel's exact location
            if (isAtPosition(bestParcel.x, bestParcel.y, currentPos.x, currentPos.y)) {
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
                if (this.explorationPath.length === 0 && !isAtPosition(bestParcel.x, bestParcel.y, currentPos.x, currentPos.y)) {
                    console.warn(`Pathfinder returned 0 steps to parcel ${bestParcel.id} at ${bestParcel.x},${bestParcel.y} which is not current position. Target likely unreachable (static obstacle or dynamic block). Banning parcel until turn ${this.currentTurn + this.BAN_DURATION}. Clearing path.`);
                    // Add the parcel ID to the ban list with an expiry turn because pathfinding failed
                    this.bannedParcels.set(bestParcel.id, this.currentTurn + this.BAN_DURATION);
                    // Clear the failed path. getAction() won't return a move this turn.
                    // The next act cycle might find a new parcel (if not banned) or go to exploration.
                    // blockedTargetTile and blockedCounter were already reset above.
                    return null; // Do not attempt to follow an empty path
                }
            }
            // Follow the calculated path (or the one already being followed towards the parcel)
            return this.followExplorationPath(currentPos.x, currentPos.y);

        }

        // 3. Optimized exploration using Pathfinder
        // If no suitable parcel target, start exploration
        // If no path is being followed for exploration, find a new exploration target
        if (this.explorationPath.length === 0) {
            console.log("No suitable parcel target, starting exploration...");
            // Reset exploration blocking state before finding a new target
            this.blockedTargetTile = null;
            this.blockedCounter = 0;

            // Find a walkable exploration target tile (using the original least-visited logic)
            // This method will now also filter out banned exploration tiles
            const explorationTarget = this.findExplorationTargetTile(currentPos.x, currentPos.y);

            if (explorationTarget) {
                console.log(`Exploration target found: ${explorationTarget.x}, ${explorationTarget.y}`);

                // Calculate the path towards the exploration target
                this.explorationPath = this.pathfinder.findPath(currentPos.x, currentPos.y, explorationTarget.x, explorationTarget.y);
                console.log(`Calculated exploration path: ${this.explorationPath.length} steps.`);

                // Handle case where pathfinding returns 0 steps to exploration target
                if (this.explorationPath.length === 0 && !isAtPosition(explorationTarget.x, explorationTarget.y, currentPos.x, currentPos.y)) {
                    const tileKey = `${explorationTarget.x},${explorationTarget.y}`;
                    this.bannedExplorationTiles.set(tileKey, this.currentTurn + this.BAN_DURATION);
                    this.explorationPath = [];
                    // Passa la tile appena bannata come set
                    const bannedThisTurn = new Set([tileKey]);
                    const newTarget = this.findExplorationTargetTile(currentPos.x, currentPos.y, bannedThisTurn);
                    if (newTarget && (newTarget.x !== explorationTarget.x || newTarget.y !== explorationTarget.y)) {
                        this.explorationPath = this.pathfinder.findPath(currentPos.x, currentPos.y, newTarget.x, newTarget.y);
                        if (this.explorationPath.length > 0) {
                            return this.followExplorationPath(currentPos.x, currentPos.y);
                        }
                    }
                    // Fallback come già hai
                    const simpleMove = this.findSimpleValidMove(currentPos.x, currentPos.y);
                    if (simpleMove) return simpleMove;
                    return null;
                }


            } else {
                console.warn("Could not find an exploration target tile (all might be banned or unreachable).");
                // Fallback if no valid/reachable exploration target is found
                const simpleMove = this.findSimpleValidMove(currentPos.x, currentPos.y);
                if (simpleMove) {
                    console.log("Falling back to simple valid move.");
                    return simpleMove;
                }
                console.error("No exploration target, no simple valid move. Agent is likely completely stuck.");
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

    // findExplorationTargetTile based on the base code (least visited walkable tile everywhere)
    // Modified to filter out banned exploration tiles.
    findExplorationTargetTile(currentX, currentY, bannedThisTurn = new Set()) {
        // 1. Prova prima nella propria area assegnata
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

        // 2. Se la propria area è vuota, cerca la più vicina tra le altre aree di spawn
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

        // 3. Fallback: esplora tra tutte le spawn tile non bannate
        const fallbackTiles = this.beliefs.getSpawnTiles().filter(tile => {
            const tileKey = `${tile.x},${tile.y}`;
            return (!this.bannedExplorationTiles.has(tileKey) || this.bannedExplorationTiles.get(tileKey) <= this.currentTurn)
                && !bannedThisTurn.has(tileKey);
        });
        if (fallbackTiles.length > 0) {
            return this.findLeastVisitedTile(currentX, currentY, fallbackTiles);
        }

        // 4. Fallback finale: esplora tra tutte le normal tiles non bannate
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
        if (tiles.length === 0) {
            return null;
        }

        let minVisits = Infinity;
        let bestTile = null;
        let minDistance = Infinity;

        // Sort available exploration tiles by distance to prioritize closer ones with same visit count
        const sortedAvailableTiles = tiles.sort((a, b) => {
            const distA = this.pathfinder.heuristic(currentX, currentY, a.x, a.y);
            const distB = this.pathfinder.heuristic(currentX, currentY, b.x, b.y);
            return distA - distB;
        });

        for (const tile of sortedAvailableTiles) {
            const key = `${tile.x},${tile.y}`;
            if (bannedThisTurn.has(key)) continue; // <-- Escludi tile appena bannate
            const visits = this.explorationMap.get(key) || 0;
            const distance = this.pathfinder.heuristic(currentX, currentY, tile.x, tile.y);

            // Choose the least visited tile among available ones, or the closest in case of a tie
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
            console.warn(`findLeastVisitedTile selected potentially unwalkable tile ${bestTile.x},${bestTile.y}. Looking for nearest walkable tile instead.`);
            const nearestValid = this.pathfinder.findNearestValidTile(bestTile.x, bestTile.y);
            if (nearestValid) {
                console.log(`Using nearest valid tile ${nearestValid.x},${nearestValid.y} as exploration target.`);
                return nearestValid;
            } else {
                console.error(`Could not find nearest valid tile for selected exploration target ${bestTile.x},${bestTile.y}. No valid exploration target found.`);
                return null;
            }
        }

        return bestTile;
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
                    // The next call to getAction() will see explorationPath is empty and find a new target/path (which will now exclude banned tiles)
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
        const directions = DIRECTIONS;
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


    updateParcelTarget() {
        const visibleParcels = this.beliefs.availableParcels;

        // Se ho già un target, controllo se è ancora visibile
        if (this.currentParcelTarget) {
            const stillVisible = visibleParcels.find(p => p.id === this.currentParcelTarget.id);
            if (stillVisible) {
                this.targetLostTurns = 0;
                return;
            } else {
                this.targetLostTurns += 1;
                // Se il target è "perso" da troppo tempo, resetto
                if (this.targetLostTurns < this.targetLostThreshold) {
                    return;
                }
            }
        }
        // Scegli un nuovo target se non ne ho uno valido
        const bestParcel = this.selectBestParcel();
        if (bestParcel) {
            this.currentParcelTarget = bestParcel;
            this.targetLostTurns = 0;
        } else {
            this.currentParcelTarget = null;
        }
    }

    setupHandoverIfNeeded() {
        const spawnTiles = this.beliefs.getSpawnTiles ? this.beliefs.getSpawnTiles() : [];
        const deliveryTiles = this.beliefs.getDeliveryTiles ? this.beliefs.getDeliveryTiles() : [];
        if (spawnTiles.length === 1 && deliveryTiles.length === 1) {
            this.isHandoverMode = true;
            this.spawnTile = spawnTiles[0];
            this.deliveryTile = deliveryTiles[0];
            const path = this.pathfinder.findPath(this.spawnTile.x, this.spawnTile.y, this.deliveryTile.x, this.deliveryTile.y);
            this.handoverTile = path.length > 2 ? path[Math.floor(path.length / 2)] : (path[1] || this.spawnTile);
            console.log(`[Planner] Handover mode enabled: Spawn at (${this.spawnTile.x}, ${this.spawnTile.y}), Delivery at (${this.deliveryTile.x}, ${this.deliveryTile.y}), Handover at (${this.handoverTile.x}, ${this.handoverTile.y})`);

            // --- Calcola ruolo usando le posizioni iniziali ---
            let myDist = Math.abs(this.beliefs.myPosition.x - this.spawnTile.x) + Math.abs(this.beliefs.myPosition.y - this.spawnTile.y);
            let minDist = myDist;
            let myId = this.beliefs.myId;
            let runnerId = myId;

            console.log(`[Planner] My initial position: (${this.beliefs.myPosition.x}, ${this.beliefs.myPosition.y}), Distance to spawn: ${myDist}`);

            // Usa le posizioni iniziali degli altri agenti
            if (this.beliefs.initialAgentPositions) {
                for (const [agentId, pos] of Object.entries(this.beliefs.initialAgentPositions)) {
                    const d = Math.abs(pos.x - this.spawnTile.x) + Math.abs(pos.y - this.spawnTile.y);
                    if (d < minDist || (d === minDist && agentId < runnerId)) {
                        minDist = d;
                        runnerId = agentId;
                    }
                }
            }

            if (myId === runnerId) {
                this.isRunner = true;
                this.isCarrier = false;
                this.myRole = RUNNER;
            } else {
                this.isRunner = false;
                this.isCarrier = true;
                this.myRole = CARRIER;
            }
            if (this.announceIntent) {
                this.announceIntent(null, null, this.myRole, this.handoverTile);
            }
        }
    }

    /**
         * Moves towards the specified (x, y) coordinates using the pathfinder.
         * Returns an action object like { action: 'up' } or null if no move is possible.
         */
    moveTo(targetX, targetY) {
        const currentPos = this.beliefs.myPosition;
        if (!currentPos) return null;
        // If already at target, no move needed
        if (isAtPosition(currentPos.x, currentPos.y, targetX, targetY)) return null;
        // Find path to target
        const path = this.pathfinder.findPath(currentPos.x, currentPos.y, targetX, targetY);
        if (path.length === 0) return null;
        const nextStep = path[0];
        const action = this.pathfinder.getActionToNextStep(currentPos.x, currentPos.y, nextStep.x, nextStep.y);
        if (action) {
            this.recordPosition(nextStep.x, nextStep.y);
            return { action: action };
        }
        return null;
    }

    moveToAdjacent(targetX, targetY) {
        // Trova una tile adiacente libera e cammina lì
        const dirs = [
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
            { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
        ];
        const pos = this.beliefs.myPosition;
        for (const dir of dirs) {
            const nx = targetX + dir.dx;
            const ny = targetY + dir.dy;
            if (this.beliefs.isWalkable(nx, ny) && !(nx === pos.x && ny === pos.y)) {
                return this.moveTo(nx, ny);
            }
        }
        return null; // Se non trova nulla, resta fermo
    }
}