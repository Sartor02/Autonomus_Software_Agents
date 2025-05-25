// agent.js
import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import { Beliefs } from "./beliefs/beliefs.js";
import { Planner } from "./strategies/planner.js";
import { DeliveryStrategy } from "./strategies/delivery.js";
import { Pathfinder } from "./plans/pathfinder.js";
import config from "../config.js";
import { HANDSHAKE, INTENT } from "./utils/utils.js";

class Agent {
    constructor(token) { // Il costruttore ora accetta un token
        this.api = new DeliverooApi(config.host, token); // Usa il token passato
        this.beliefs = new Beliefs();
        this.pathfinder = new Pathfinder(this.beliefs);
        this.deliveryStrategy = new DeliveryStrategy(this.beliefs, this.pathfinder);
        this.strategy = new Planner(this.beliefs, this.deliveryStrategy, this.pathfinder);

        this.isActing = false; // To avoid overlapping actions
        this.knownAgents = new Set();
        this.hasAnnounced = false;
        this.areaAnnounced = false;

        this.lastAnnouncedTarget = null;
        this.setupEventListeners();
        this.startActLoop();
    }

    setupEventListeners() {
        this.api.onYou(({ id, x, y, score }) => {
            const newPos = { x: Math.floor(x), y: Math.floor(y) };
            const posChanged = !this.beliefs.myPosition || newPos.x !== this.beliefs.myPosition.x || newPos.y !== this.beliefs.myPosition.y;

            this.beliefs.myId = id;
            this.beliefs.myPosition = newPos;
            this.beliefs.myScore = score;

            // Aggiungi l'ID dell'agente a knownAgents non appena lo conosce
            if (!this.knownAgents.has(id)) {
                this.knownAgents.add(id);
                console.log(`[AGENT - ${this.beliefs.myId}] Added myself to known agents:`, Array.from(this.knownAgents));
            }

            // Annuncio di identificazione solo una volta
            if (!this.hasAnnounced) {
                this.api.emitShout(JSON.stringify({
                    type: HANDSHAKE,
                    agentId: id,
                    position: this.beliefs.myPosition
                }));
                this.hasAnnounced = true;
            }

            if (posChanged) {
                this.strategy.recordPosition(newPos.x, newPos.y);
            }

            // Ricezione broadcast di identificazione
            this.api.onMsg((fromId, name, msg, reply) => {
                try {
                    const data = typeof msg === "string" ? JSON.parse(msg) : msg;
                    console.log(`[AGENT - ${this.beliefs.myId}] Received message from ${fromId}:`, data);
                    // Identificazione (broadcast)
                    if (data.type === HANDSHAKE && data.agentId && data.agentId !== this.beliefs.myId) {
                        this.knownAgents.add(data.agentId);
                        console.log(`[AGENT - ${this.beliefs.myId}] Known agents updated:`, Array.from(this.knownAgents));
                        // Puoi anche salvare la posizione iniziale degli altri agenti se utile
                    }
                    // Intenti
                    if (data.type === INTENT && data.agentId && data.agentId !== this.beliefs.myId) {
                        this.beliefs.updateAgentIntent(data.agentId, data);
                        console.log(`[AGENT - ${this.beliefs.myId}] Updated intent for agent ${data.agentId}`);
                    }
                } catch (e) { }
            });

            const expectedAgents = config.token.length;
            if (!this.areaAnnounced && this.knownAgents.size === expectedAgents) {
                console.log(`[AGENT - ${this.beliefs.myId}] All agents known (${this.knownAgents.size}/${expectedAgents}). Announcing area intent.`);
                const areaTiles = this.getAssignedSpawnArea();
                if (areaTiles) {
                    console.log(`[AGENT - ${this.beliefs.myId}] Assigned area tiles:`, areaTiles);
                    this.announceAreaIntent(areaTiles);
                    this.areaAnnounced = true;
                    this.beliefs.myAssignedArea = areaTiles; // Salva l'area assegnata
                }
            }
        });

        this.api.onParcelsSensing((parcels) => {
            this.beliefs.updateFromSensing({ parcels });
            this.deliveryStrategy.updateCarriedParcels(this.beliefs.parcels);
        });

        this.api.onAgentsSensing((agents) => {
            const previousPos = this.beliefs.myPosition;
            this.beliefs.updateFromSensing({ agents });
            const currentPos = this.beliefs.myPosition;

            if (currentPos && (!previousPos || currentPos.x !== previousPos.x || currentPos.y !== previousPos.y)) {
                this.strategy.recordPosition(currentPos.x, currentPos.y);
            }
        });

        this.api.onMap((width, height, tiles) => {
            this.beliefs.updateMapInfo(width, height, tiles);
            this.strategy.initializeMapKnowledge();
        });
    }

    announceIntent(target, area) {
        if (!target) return;
        const intentMsg = JSON.stringify({
            type: INTENT,
            agentId: this.beliefs.myId,
            target,
            area // puoi aggiungere info sull'area di spawn scelta
        });
        // Comunica direttamente a tutti gli altri agenti noti
        for (const otherId of this.knownAgents) {
            this.api.emitSay(intentMsg, otherId);
        }
        // (opzionale) fallback broadcast per agenti non ancora noti
        this.api.emitShout(intentMsg);
        this.lastAnnouncedTarget = target;
    }

    getAssignedSpawnArea() {
        const areas = this.beliefs.getSpawnAreasFromTiles();

        if (areas.length === 1) {
            // Divisione longitudinale (per x) o latitudinale (per y)
            console.log(`[AGENT - ${this.beliefs.myId}] Only one spawn area available, dividing it.`);
            const area = areas[0];
            const allAgents = Array.from(this.knownAgents);
            allAgents.push(this.beliefs.myId);
            allAgents.sort();
            const myIndex = allAgents.indexOf(this.beliefs.myId);

            // Trova il bounding box dell'area
            const minX = Math.min(...area.map(t => t.x));
            const maxX = Math.max(...area.map(t => t.x));
            const minY = Math.min(...area.map(t => t.y));
            const maxY = Math.max(...area.map(t => t.y));

            // Scegli la divisione più lunga
            if ((maxX - minX) >= (maxY - minY)) {
                // Divisione verticale (per x)
                const midX = Math.floor((minX + maxX) / 2);
                const areaFiltered = area.filter(t => myIndex === 0 ? t.x <= midX : t.x > midX);
                return areaFiltered;
            } else {
                console.log(`[AGENT - ${this.beliefs.myId}] Dividing area horizontally.`);
                // Divisione orizzontale (per y)
                const midY = Math.floor((minY + maxY) / 2);
                const areaFiltered = area.filter(t => myIndex === 0 ? t.y <= midY : t.y > midY);
                return areaFiltered;
            }
        }

        // Ordina agenti per id
        const allAgents = Array.from(this.knownAgents);
        allAgents.push(this.beliefs.myId);
        allAgents.sort();
        const myIndex = allAgents.indexOf(this.beliefs.myId);

        // Ordina le aree per grandezza (decrescente)
        const sortedAreas = [...areas].sort((a, b) => b.length - a.length);

        // Se ci sono più aree, assegna in base all'indice
        return sortedAreas[myIndex % sortedAreas.length];
    }

    announceAreaIntent(areaTiles) {
        const area = areaTiles.map(tile => ({ x: tile.x, y: tile.y }));
        const intentMsg = JSON.stringify({
            type: INTENT,
            agentId: this.beliefs.myId,
            area
        });
        for (const otherId of this.knownAgents) {
            this.api.emitSay(intentMsg, otherId);
        }
        this.api.emitShout(intentMsg);
    }

    startActLoop() {
        setInterval(() => this.act(), 20); // 50 times per second
    }

    async act() {
        if (this.isActing || !this.beliefs.myPosition || this.beliefs.mapWidth === 0) return;

        const currentPos = this.beliefs.myPosition;
        const parcelAtCurrentPos = this.beliefs.availableParcels.find(p =>
            p.x === currentPos.x && p.y === currentPos.y
        );

        if (parcelAtCurrentPos) {
            this.isActing = true;
            try {
                await this.api.emitPickup();
                await this.delay(100);
            } catch (err) {
                console.error(`Reactive pickup failed for parcel ${parcelAtCurrentPos.id}:`, err);
                this.strategy.explorationPath = [];
                this.deliveryStrategy.deliveryPath = [];
            } finally {
                this.isActing = false;
            }
            return;
        }

        this.isActing = true;

        const action = this.strategy.getAction();
        if (action && action.target) {
            this.announceIntent(action.target);
        }

        if (!action) {
            this.isActing = false;
            return;
        }

        try {
            switch (action.action) {
                case 'move_up': await this.api.emitMove('up'); break;
                case 'move_down': await this.api.emitMove('down'); break;
                case 'move_left': await this.api.emitMove('left'); break;
                case 'move_right': await this.api.emitMove('right'); break;
                case 'pickup': await this.api.emitPickup(); break;
                case 'putdown': await this.api.emitPutdown(); break;
                default: console.warn("Unknown action returned by strategy:", action.action); break;
            }
            await this.delay(10);
        } catch (err) {
            console.error(`Strategy action "${action.action}" failed:`, err);
            if (action.action.startsWith('move')) {
                this.strategy.explorationPath = [];
                this.deliveryStrategy.deliveryPath = [];
            } else if (action.action === 'pickup') {
                this.strategy.explorationPath = [];
            }
        } finally {
            this.isActing = false;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Crea un agente per ogni token nel config
config.token.forEach(token => new Agent(token));