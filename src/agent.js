import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import { Beliefs } from "./beliefs/beliefs.js";
import { GreedyStrategy } from "./strategies/greedy.js";
import { DeliveryStrategy } from "./strategies/delivery.js";
import config from "../config.js";

class Agent {
    constructor() {
        this.api = new DeliverooApi(config.host, config.token);
        this.beliefs = new Beliefs();
        this.deliveryStrategy = new DeliveryStrategy(this.beliefs);
        this.strategy = new GreedyStrategy(this.beliefs, this.deliveryStrategy);
        this.isActing = false; // To avoid overlapping actions
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.api.onYou(({id, x, y, score}) => {
            this.beliefs.myId = id;
            this.beliefs.myPosition = {x, y};
            this.beliefs.myScore = score;
            this.act();
        });
        
        this.api.onParcelsSensing((parcels) => {
            this.beliefs.updateFromSensing({ parcels });
            this.deliveryStrategy.updateCarriedParcels(parcels);
            this.act();
        });
        
        this.api.onAgentsSensing((agents) => {
            this.beliefs.updateFromSensing({ agents });
        });
        
        this.api.onMap((width, height, tiles) => {
            this.beliefs.updateMapInfo(width, height, tiles);
        });
    }

    async act() {
        if (this.isActing) return; // Avoid executing multiple actions simultaneously
        this.isActing = true;

        const action = this.strategy.getAction();
        if (!action) {
            this.isActing = false;
            return;
        }
        if( action.action === 'pickup' ) {
            this.deliveryStrategy.updateCarriedParcels(this.beliefs.parcels.filter(p => p.carriedBy === this.beliefs.myId));
        }

        try {
            switch(action.action) {
                case 'move_up': await this.api.emitMove('up'); break;
                case 'move_down': await this.api.emitMove('down'); break;
                case 'move_left': await this.api.emitMove('left'); break;
                case 'move_right': await this.api.emitMove('right'); break;
                case 'pickup': await this.api.emitPickup(); break;
                case 'putdown': await this.api.emitPutdown(); break;
            }
            await this.delay(50); // 500ms delay between actions
        } catch (err) {
            console.error('Action failed:', err);
        } finally {
            this.isActing = false;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

new Agent();