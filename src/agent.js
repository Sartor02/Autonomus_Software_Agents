import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import { Beliefs } from "./beliefs/beliefs.js";
import { Planner } from "./strategies/planner.js";
import { DeliveryStrategy } from "./strategies/delivery.js";
import { Pathfinder } from "./plans/pathfinder.js";
import { CommunicationHandler } from "./coordination/communication_handler.js";
import { AreaManager } from "./coordination/area_manager.js";
import config from "../config.js";
import { HANDSHAKE, INTENT, createActionMap } from "./utils/utils.js";

class Agent {
    constructor(token) {
        this.api = new DeliverooApi(config.host, token);
        this.beliefs = new Beliefs();
        this.pathfinder = new Pathfinder(this.beliefs);
        this.deliveryStrategy = new DeliveryStrategy(this.beliefs, this.pathfinder);
        /** @type{Planner} */
        this.strategy = new Planner(
            this.beliefs,
            this.deliveryStrategy,
            this.pathfinder,
            (target, area, role, handoverTile) => this.announceIntent(target, area, role, handoverTile)
        );

        // Communication and coordination
        this.communicationHandler = new CommunicationHandler(this.api, this.beliefs);
        this.areaManager = new AreaManager(this.beliefs);
        this.knownAgents = new Set();
        this.actionMap = createActionMap(this.api);
        this.setupEventListeners();
        this.startActLoop();
    }

    setupEventListeners() {
        this.api.onYou((data) => this.handleSelfUpdate(data));
        this.api.onParcelsSensing((parcels) => this.handleParcelSensing(parcels));
        this.api.onAgentsSensing((agents) => this.handleAgentSensing(agents));
        this.api.onMap((width, height, tiles) => this.handleMapUpdate(width, height, tiles));
        this.api.onMsg((fromId, name, msg, reply) => this.handleMessage(fromId, msg));
    }

    handleSelfUpdate({ id, x, y, score }) {
        const newPos = { x: Math.floor(x), y: Math.floor(y) };
        const posChanged = this.updateSelfData(id, newPos, score);

        this.addSelfToKnownAgents(id);
        this.communicationHandler.announcePresence(id, this.beliefs.myPosition);
        
        if (posChanged) {
            this.strategy.recordPosition(newPos.x, newPos.y);
        }

        this.strategy.setupHandoverIfNeeded()
        this.areaManager.announceAreaIfAllAgentsKnown(
            this.knownAgents, 
            this.beliefs.myId, 
            config.token.length, 
            this.communicationHandler
        );
    }

    updateSelfData(id, newPos, score) {
        const posChanged = !this.beliefs.myPosition || 
            newPos.x !== this.beliefs.myPosition.x || 
            newPos.y !== this.beliefs.myPosition.y;

        this.beliefs.myId = id;
        this.beliefs.myPosition = newPos;
        this.beliefs.myScore = score;

        return posChanged;
    }

    addSelfToKnownAgents(id) {
        if (!this.knownAgents.has(id)) {
            this.knownAgents.add(id);
            console.log(`[AGENT - ${this.beliefs.myId}] Added myself to known agents:`, Array.from(this.knownAgents));
        }
    }

    handleParcelSensing(parcels) {
        this.beliefs.updateFromSensing({ parcels });
        this.deliveryStrategy.updateCarriedParcels(this.beliefs.parcels);
    }

    handleAgentSensing(agents) {
        const previousPos = this.beliefs.myPosition;
        this.beliefs.updateFromSensing({ agents });
        const currentPos = this.beliefs.myPosition;

        if (this.hasPositionChanged(previousPos, currentPos)) {
            this.strategy.recordPosition(currentPos.x, currentPos.y);
        }
    }

    hasPositionChanged(previousPos, currentPos) {
        return currentPos && (!previousPos || 
            currentPos.x !== previousPos.x || 
            currentPos.y !== previousPos.y);
    }

    handleMapUpdate(width, height, tiles) {
        this.beliefs.updateMapInfo(width, height, tiles);
        this.strategy.initializeMapKnowledge();
    }

    handleMessage(fromId, msg) {
        console.log(`[📧📧📧📧📧📧📧📧📧📧📧📧AGENT - ${this.beliefs.myId}] Received message from ${fromId}:`, msg);
        if (!msg) return;

        if (!msg) msg.agentId = fromId;

        if (msg.type === HANDSHAKE) {
            this.handleHandshakeMessage(msg);
        } else if (msg.type === INTENT) {
            this.handleIntentMessage(msg);
        }
    }

    handleHandshakeMessage(data) {
        if (data.agentId === this.beliefs.myId) return;

        this.knownAgents.add(data.agentId);
        this.beliefs.setAgentPosition(data.agentId, data.position);
        
        console.log(`[AGENT - ${this.beliefs.myId}] Known agents updated:`, Array.from(this.knownAgents));
    }

    handleIntentMessage(data) {
        if (data.agentId === this.beliefs.myId) return;

        this.beliefs.updateAgentIntent(data.agentId, data);
        if (data.role) {
            this.beliefs.agentRoles[data.agentId] = data.role;
        }
        
        if (data.handoverTile) {
            console.log(`⚠️⚠️⚠️⚠️[AGENT - ${this.beliefs.myId}] Handover tile for agent ${data.agentId}:`, data.handoverTile);
            this.strategy.setHandoverTile(data.handoverTile);
        }
        
        console.log(`[AGENT - ${this.beliefs.myId}] Updated intent for agent ${data.agentId}`);
    }

    announceIntent(target, area, role, handoverTile) {
        if (!target && !role) return;
        
        this.communicationHandler.announceIntent(
            this.beliefs.myId,
            target,
            area,
            role,
            handoverTile,
            this.knownAgents
        );
    }

    announceAreaIntent(areaTiles) {
        const area = areaTiles.map(tile => ({ x: tile.x, y: tile.y }));
        this.communicationHandler.announceAreaIntent(this.beliefs.myId, area, this.knownAgents);
    }

    startActLoop() {
        setTimeout(() => {
            this.act().finally(() => {
                this.startActLoop();  // Schedule next only after current completes
            });
        }, 0);
    }

    async act() {
        try {
            const action = await this.strategy.getAction();
            if (action?.target) {
                this.announceIntent(action.target);
            }

            if (action) {
                await this.executeAction(action);
            }
        } catch (err) {
            this.resetPaths("Strategy action failed:", err);
        }
    }

    async executeAction(action) {
        console.log(`[AGENT - ${this.beliefs.myId}] Strategy action:`, action);
        const actionFunction = this.actionMap[action.action];
        console.log(`[AGENT - ${this.beliefs.myId}] Executing action:`, action.action);
        if (actionFunction) {
            await actionFunction();
        } else {
            console.warn("Unknown action returned by strategy:", action.action);
        }
    }

    resetPaths(msg, err) {
        console.error(msg, err);
        this.strategy.clearPath();
        this.deliveryStrategy.deliveryPath = [];
    }
}

export default Agent;