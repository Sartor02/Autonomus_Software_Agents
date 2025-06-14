import { PddlProblem, onlineSolver } from "@unitn-asa/pddl-client";
import { readFile } from "../utils/utils.js";

export class PddlPathfinder {
    constructor(beliefs) {
        this.beliefs = beliefs;
        this.domain = null;
        this.initialized = false;
    }

    async initialize() {
        if (!this.initialized) {
            try {
                this.domain = await readFile('./src/plans/delivero-domain.pddl');
                console.log("PDDL domain loaded successfully");
                this.initialized = true;
            } catch (error) {
                console.error("Failed to load PDDL domain:", error);
                throw error;
            }
        }
    }

    // Generates a beliefset compatible with PddlProblem
    generateBeliefset(startX, startY, targetX, targetY) {
        const objects = [];
        const facts = [];

        // Limit the area for performance
        const range = 5;
        const minX = Math.max(0, Math.min(startX, targetX) - range);
        const maxX = Math.min(this.beliefs.mapWidth - 1, Math.max(startX, targetX) + range);
        const minY = Math.max(0, Math.min(startY, targetY) - range);
        const maxY = Math.min(this.beliefs.mapHeight - 1, Math.max(startY, targetY) + range);

        console.log(`PDDL area: (${minX},${minY}) to (${maxX},${maxY})`);

        // Add tile objects
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                if (this.beliefs.isWalkable(x, y)) {
                    objects.push(`t${x}_${y}`);
                }
            }
        }

        // Add directional facts
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                if (!this.beliefs.isWalkable(x, y)) continue;

                // Right: if x+1,y is walkable
                if (x + 1 <= maxX && this.beliefs.isWalkable(x + 1, y)) {
                    facts.push(`(right t${x + 1}_${y} t${x}_${y})`);
                }

                // Left: if x-1,y is walkable
                if (x - 1 >= minX && this.beliefs.isWalkable(x - 1, y)) {
                    facts.push(`(left t${x - 1}_${y} t${x}_${y})`);
                }

                // Up: if x,y+1 is walkable
                if (y + 1 <= maxY && this.beliefs.isWalkable(x, y + 1)) {
                    facts.push(`(up t${x}_${y + 1} t${x}_${y})`);
                }

                // Down: if x,y-1 is walkable
                if (y - 1 >= minY && this.beliefs.isWalkable(x, y - 1)) {
                    facts.push(`(down t${x}_${y - 1} t${x}_${y})`);
                }
            }
        }

        return {
            objects: objects,
            facts: facts
        };
    }

    // Main pathfinding method using the correct pattern
    async findPath(startX, startY, targetX, targetY) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // Check that start and target are walkable
            if (!this.beliefs.isWalkable(startX, startY)) {
                console.error(`Start position (${startX},${startY}) is not walkable`);
                return [];
            }

            if (!this.beliefs.isWalkable(targetX, targetY)) {
                console.error(`Target position (${targetX},${targetY}) is not walkable`);
                return [];
            }

            console.log(`PDDL pathfinding from (${startX},${startY}) to (${targetX},${targetY})`);

            // Define the PDDL goal
            let goal = `at t${targetX}_${targetY}`;

            // Generate beliefset
            const beliefset = this.generateBeliefset(startX, startY, targetX, targetY);

            // Add current position to facts
            const allFacts = beliefset.facts.concat([`(at t${startX}_${startY})`]);

            console.log(`Generated: ${beliefset.objects.length} objects, ${allFacts.length} facts`);

            // Create the PDDL problem using PddlProblem
            var pddlProblem = new PddlProblem(
                'deliveroo',
                beliefset.objects.join(' '),
                allFacts.join(' '),
                goal
            );

            let problemString = pddlProblem.toPddlString();
            console.log("Generated PDDL Problem:");
            console.log(problemString);

            // Get the plan from the online solver
            console.log("Calling onlineSolver...");
            var plan = await onlineSolver(this.domain, problemString);

            console.log("PDDL Solver result:", plan);

            // Parse the plan to get the path using the correct format
            let path = [];

            if (plan && Array.isArray(plan) && plan.length > 0) {
                console.log("Processing plan actions...");

                plan.forEach((action, index) => {
                    console.log(`Action ${index}:`, action);

                    if (action && action.args && action.args.length >= 2) {
                        // The second argument is the destination
                        let destination = action.args[1];
                        if (destination && destination.includes('_')) {
                            let coords = destination.split('_');
                            if (coords.length >= 2) {
                                let x = parseInt(coords[0].substring(1)); // Remove 't' prefix
                                let y = parseInt(coords[1]);

                                path.push({ x: x, y: y });
                                console.log(`Added step: (${x},${y})`);
                            }
                        }
                    }
                });

                console.log(`PDDL found path with ${path.length} steps:`, path);
                return path;
            } else {
                console.warn("No valid plan found or plan is empty");
                return [];
            }

        } catch (error) {
            console.error("PDDL planning error:", error);
            return [];
        }
    }
}