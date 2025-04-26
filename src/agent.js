// agent.js
import { DeliverooApi } from "@unitn-asa/deliveroo-js-client";
import { Beliefs } from "./beliefs/beliefs.js";
import { GreedyStrategy } from "./strategies/greedy.js";
import { DeliveryStrategy } from "./strategies/delivery.js";
import { Pathfinder } from "./plans/pathfinder.js";
import config from "../config.js";

class Agent {
    constructor() {
        this.api = new DeliverooApi(config.host, config.token);
        this.beliefs = new Beliefs();
        this.pathfinder = new Pathfinder(this.beliefs); 
        this.deliveryStrategy = new DeliveryStrategy(this.beliefs, this.pathfinder);
        this.strategy = new GreedyStrategy(this.beliefs, this.deliveryStrategy, this.pathfinder); 

        this.isActing = false; // To avoid overlapping actions

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.api.onYou(({id, x, y, score}) => {
            // Ensure position is integer coordinates
            const newPos = { x: Math.floor(x), y: Math.floor(y) };
            const posChanged = !this.beliefs.myPosition || newPos.x !== this.beliefs.myPosition.x || newPos.y !== this.beliefs.myPosition.y;

            this.beliefs.myId = id;
            this.beliefs.myPosition = newPos;
            this.beliefs.myScore = score;

            if (posChanged) {
                 // Record position in exploration map whenever position actually changes
                 this.strategy.recordPosition(this.beliefs.myPosition.x, this.beliefs.myPosition.y);
            }
            this.act();
        });

        this.api.onParcelsSensing((parcels) => {
            this.beliefs.updateFromSensing({ parcels });
            this.deliveryStrategy.updateCarriedParcels(this.beliefs.parcels); 
            this.act(); // Act based on new parcel info
        });

        this.api.onAgentsSensing((agents) => {
            const previousPos = this.beliefs.myPosition; // Store previous position to check if it changes
            this.beliefs.updateFromSensing({ agents });
             const currentPos = this.beliefs.myPosition; // Get potentially updated position

             // Check if my position was updated by sensing and has actually changed
             if (currentPos && (!previousPos || currentPos.x !== previousPos.x || currentPos.y !== previousPos.y)) {
                  this.strategy.recordPosition(currentPos.x, currentPos.y);
                  this.act(); // Act because my position changed
             } else if (agents.some(a => a.id !== this.beliefs.myId)) {
                  // Act if other agents changed, even if my position didn't (e.g., someone took a parcel I wanted)
                  this.act();
             }
        });

        this.api.onMap((width, height, tiles) => {
            this.beliefs.updateMapInfo(width, height, tiles);
        });
    }

    async act() {
        // Only act if beliefs are ready (especially position and map info for pathfinding)
        if (this.isActing || !this.beliefs.myPosition || this.beliefs.mapWidth === 0) {
            // console.log("Waiting to act: isActing", this.isActing, "myPosition", !!this.beliefs.myPosition, "mapReady", this.beliefs.mapWidth > 0);
            return;
        }

        // --- Reactive Pickup Check: Max priority ---
        const currentPos = this.beliefs.myPosition;
        const parcelAtCurrentPos = this.beliefs.availableParcels.find(p =>
             p.x === currentPos.x && p.y === currentPos.y
        );

        // Check if there's a parcel at the current position
        if (parcelAtCurrentPos){ 
             console.log(`Reactive pickup: Found parcel ${parcelAtCurrentPos.id} at current location ${currentPos.x},${currentPos.y}. Picking up.`);
             this.isActing = true; // Set flag to prevent other actions
             try {
                 await this.api.emitPickup();
                 await this.delay(100);
             } catch (err) {
                 console.error(`Reactive pickup failed for parcel ${parcelAtCurrentPos.id}:`, err);
                  // If pickup fails, perhaps the parcel was just taken by someone else.
                  // Clearing path might be wise as the target is gone.
                  this.strategy.explorationPath = [];
                  this.deliveryStrategy.deliveryPath = [];
             } finally {
                 this.isActing = false;
             }
             return;
        }
        // --- End Reactive Pickup Check ---


        // If not performing a reactive pickup, ask the strategy for the next action
        this.isActing = true;

        const action = this.strategy.getAction();
        // console.log("Agent decided action:", action);

        if (!action) { // Handle case where strategy returns null (e.g., no target, no moves)
             console.log("Strategy returned no action.");
             this.isActing = false;
             return;
        }

         try {
             switch(action.action) {
                 case 'move_up': await this.api.emitMove('up'); break;
                 case 'move_down': await this.api.emitMove('down'); break;
                 case 'move_left': await this.api.emitMove('left'); break;
                 case 'move_right': await this.api.emitMove('right'); break;
                 case 'pickup': 
                     console.log(`Attempting planned pickup (strategy) for target ${action.target}...`);
                     await this.api.emitPickup();
                     break;
                 case 'putdown':
                      console.log("Attempting putdown (strategy)...");
                      await this.api.emitPutdown();
                     break;
                 default:
                     console.warn("Unknown action returned by strategy:", action.action);
                     break;
             }
             // Add a small delay to prevent overwhelming the server
            await this.delay(10);
         } catch (err) {
             console.error(`Strategy action "${action.action}" failed:`, err);
              if (action.action.startsWith('move')) {
                  console.warn("Move action failed, clearing paths.");
                  this.strategy.explorationPath = []; // Clear paths on failed move
                  this.deliveryStrategy.deliveryPath = [];
              } else if (action.action === 'pickup') {
                   console.warn("Pickup action failed, clearing paths.");
                   // If a planned pickup fails, the parcel might be gone, clear path to it.
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