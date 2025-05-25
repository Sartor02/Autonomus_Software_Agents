// agent.js
import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import { Beliefs } from "./beliefs/beliefs.js";
import { Planner } from "./strategies/planner.js";
import { DeliveryStrategy } from "./strategies/delivery.js";
import { Pathfinder } from "./plans/pathfinder.js";
import config from "../config.js";

class Agent {
    constructor() {
        this.api = new DeliverooApi(config.host, config.token[0]);
        this.beliefs = new Beliefs();
        this.pathfinder = new Pathfinder(this.beliefs);
        this.deliveryStrategy = new DeliveryStrategy(this.beliefs, this.pathfinder);
        this.strategy = new Planner(this.beliefs, this.deliveryStrategy, this.pathfinder);

        this.isActing = false; // To avoid overlapping actions

        this.setupEventListeners();
        this.startActLoop(); // <--- ADDED ACT LOOP
    }

    setupEventListeners() {
        this.api.onYou(({ id, x, y, score }) => {
            const newPos = { x: Math.floor(x), y: Math.floor(y) };
            const posChanged = !this.beliefs.myPosition || newPos.x !== this.beliefs.myPosition.x || newPos.y !== this.beliefs.myPosition.y;

            this.beliefs.myId = id;
            this.beliefs.myPosition = newPos;
            this.beliefs.myScore = score;

            if (posChanged) {
                this.strategy.recordPosition(newPos.x, newPos.y);
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

new Agent();
