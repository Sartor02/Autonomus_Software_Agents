import { HandshakeMessage, IntentMessage } from "../utils/message.js";

export class CommunicationHandler {
    constructor(api, beliefs) {
        this.api = api;
        this.beliefs = beliefs;
        this.hasAnnounced = false;
    }

    announcePresence(agentId, position) {
        if (this.hasAnnounced) return;
        let message = new HandshakeMessage(agentId, position);
        this.api.emitShout(message);
        this.hasAnnounced = true;
    }

    announceIntent(agentId, target, area, role, handoverTile, knownAgents) {
        let message = new IntentMessage(agentId, target, area, role, handoverTile);

        // Send to known agents
        for (const otherId of knownAgents) {
            this.api.emitSay(message, otherId);
        }
        
        // Fallback broadcast
        this.api.emitShout(message);
    }

    announceAreaIntent(agentId, area, knownAgents) {
        let message = new IntentMessage(agentId, null, area);

        for (const otherId of knownAgents) {
            this.api.emitSay(message, otherId);
        }
        this.api.emitShout(message);
    }
}