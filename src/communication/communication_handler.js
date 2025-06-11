import { HANDSHAKE, INTENT } from "../utils/utils.js";

export class CommunicationHandler {
    constructor(api, beliefs) {
        this.api = api;
        this.beliefs = beliefs;
        this.hasAnnounced = false;
    }

    parseMessage(msg) {
        try {
            return typeof msg === "string" ? JSON.parse(msg) : msg;
        } catch (e) {
            console.error('Failed to parse message:', e);
            return null;
        }
    }

    announcePresence(agentId, position) {
        if (this.hasAnnounced) return;

        const message = {
            type: HANDSHAKE,
            agentId,
            position
        };
        this.api.emitShout(JSON.stringify(message));
        this.hasAnnounced = true;
    }

    announceIntent(agentId, target, area, role, handoverTile, knownAgents) {
        const intentMsg = JSON.stringify({
            type: INTENT,
            agentId,
            target,
            area,
            role,
            handoverTile
        });

        // Send to known agents
        for (const otherId of knownAgents) {
            this.api.emitSay(intentMsg, otherId);
        }
        
        // Fallback broadcast
        this.api.emitShout(intentMsg);
    }

    announceAreaIntent(agentId, area, knownAgents) {
        const intentMsg = JSON.stringify({
            type: INTENT,
            agentId,
            area
        });

        for (const otherId of knownAgents) {
            this.api.emitSay(intentMsg, otherId);
        }
        this.api.emitShout(intentMsg);
    }
}