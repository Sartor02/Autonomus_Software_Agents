import { HANDSHAKE, INTENT } from "./utils.js";

export class BaseMessage {
    constructor(type, agentId) {
        this.type = type;
        this.agentId = agentId;
    }
}

export class HandshakeMessage extends BaseMessage {
    constructor(agentId, position) {
        super(HANDSHAKE, agentId);
        this.position = position;
    }

    static fromData(data) {
        const msg = new HandshakeMessage(data.agentId, data.position);
        return msg;
    }

    isValid() {
        return this.agentId && 
               this.position && 
               typeof this.position.x === 'number' && 
               typeof this.position.y === 'number';
    }
}

export class IntentMessage extends BaseMessage {
    constructor(agentId, target = null, area = null, role = null, handoverTile = null) {
        super(INTENT, agentId);
        this.target = target;
        this.area = area;
        this.role = role;
        this.handoverTile = handoverTile;
    }

    static fromData(data) {
        const msg = new IntentMessage(
            data.agentId,
            data.target,
            data.area,
            data.role,
            data.handoverTile
        );
        return msg;
    }

    isValid() {
        return this.agentId && (
            this.target || 
            this.area || 
            this.role || 
            this.handoverTile
        );
    }
}