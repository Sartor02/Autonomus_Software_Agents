import { DIRECTIONS, ACTIONS, USE_PDDL_PLANNER, PDDL_TIMEOUT } from "../utils/utils.js";
import { PddlPathfinder } from "./PDDLplan.js";

export class Pathfinder {
    constructor(beliefs) {
        this.beliefs = beliefs;

        // Initialize PDDL pathfinder if enabled
        if (USE_PDDL_PLANNER) {
            this.pddlPathfinder = new PddlPathfinder(beliefs);
            this.pddlCache = new Map(); // Cache per risultati precedenti
            this.pddlTimeout = PDDL_TIMEOUT; // timeout per PDDL
            this.pddlPendingRequests = new Map(); // Track pending PDDL requests
            console.log("[Pathfinder] PDDL planning enabled with timeout");
        }
    }

    // Manhattan distance heuristic
    heuristic(x1, y1, x2, y2) {
        return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    }

    // Main pathfinding method with PDDL
    findPath(startX, startY, targetX, targetY) {
        if (USE_PDDL_PLANNER && this.pddlPathfinder) {
            const cacheKey = `${startX},${startY}->${targetX},${targetY}`;

            // 1. Check cache for recent PDDL results
            const cachedResult = this.getCachedResult(cacheKey);
            if (cachedResult !== null) {
                console.log("Using cached PDDL result");
                return cachedResult;
            }

            // 2. If there's a pending PDDL request, use A* to avoid blocking
            if (this.pddlPendingRequests.has(cacheKey)) {
                console.log("PDDL request already pending");
                return this.findPathAStar(startX, startY, targetX, targetY);
            }

            // 3. Try PDDL with a short timeout
            const pddlPath = this.tryPddlWithShortTimeout(startX, startY, targetX, targetY, cacheKey);
            if (pddlPath !== null) {
                console.log(`PDDL succeeded with ${pddlPath.length} steps`);
                return pddlPath;
            }

            console.log("PDDL timeout, using A* and starting background PDDL");
            // 4. Start PDDL in background for future use
            this.startBackgroundPddl(startX, startY, targetX, targetY, cacheKey);
        }

        // Fallback to A* pathfinding
        return this.findPathAStar(startX, startY, targetX, targetY);
    }

    // Try PDDL with a short timeout
    tryPddlWithShortTimeout(startX, startY, targetX, targetY, cacheKey) {
        try {
            console.log(`Trying PDDL with ${this.pddlTimeout}ms timeout`);

            const startTime = Date.now();
            let result = [];
            let completed = false;
            let error = null;

            // Start PDDL
            const pddlPromise = this.pddlPathfinder.findPath(startX, startY, targetX, targetY);

            pddlPromise.then(res => {
                result = res;
                completed = true;
                // Save it in cache if successful
                this.pddlCache.set(cacheKey, {
                    path: res || [],
                    timestamp: Date.now()
                });
            }).catch(err => {
                error = err;
                completed = true;
                // Save it in cache as failed
                this.pddlCache.set(cacheKey, {
                    path: [],
                    timestamp: Date.now(),
                    failed: true
                });
            });

            // Busy wait for completion or timeout
            while (!completed && (Date.now() - startTime) < this.pddlTimeout) {
                this.busyWait(50); // Check every 50ms
            }

            if (!completed) {
                console.log(`PDDL timeout after ${this.pddlTimeout}ms`);
                return null;
            }

            if (error) {
                console.warn("PDDL error:", error);
                return null;
            }

            if (Array.isArray(result) && result.length >= 0) {
                return result;
            }

        } catch (error) {
            console.warn("PDDL planning failed:", error);
        }

        return null;
    }

    // STart PDDL in the background
    startBackgroundPddl(startX, startY, targetX, targetY, cacheKey) {
        if (this.pddlPendingRequests.has(cacheKey)) {
            return; // Already pending request for this path
        }

        console.log(`Starting background PDDL for ${cacheKey}`);
        this.pddlPendingRequests.set(cacheKey, Date.now());

        this.pddlPathfinder.findPath(startX, startY, targetX, targetY)
            .then(path => {
                console.log(`Background PDDL completed for ${cacheKey}`);
                this.pddlCache.set(cacheKey, {
                    path: path || [],
                    timestamp: Date.now()
                });
                this.pddlPendingRequests.delete(cacheKey);
            })
            .catch(error => {
                console.warn(`Background PDDL failed for ${cacheKey}:`, error);
                this.pddlCache.set(cacheKey, {
                    path: [],
                    timestamp: Date.now(),
                    failed: true
                });
                this.pddlPendingRequests.delete(cacheKey);
            });
    }

    // Busy wait
    busyWait(ms) {
        const start = Date.now();
        while (Date.now() - start < ms) {
            // Busy wait
        }
    }

    // Check cache for PDDL results
    getCachedResult(cacheKey) {
        if (this.pddlCache.has(cacheKey)) {
            const cached = this.pddlCache.get(cacheKey);
            const isValid = cached.timestamp > Date.now() - 300000; // Valid for 5 minutes

            if (isValid) {
                if (cached.failed) {
                    // If the cached result is marked as failed, check cooldown
                    const timeSinceFailure = Date.now() - cached.timestamp;
                    if (timeSinceFailure < 10000) { // 10 seconds cooldown
                        return null;
                    }
                    // Remove failed cache entry after cooldown
                    this.pddlCache.delete(cacheKey);
                    return null;
                }
                return cached.path;
            } else {
                // Cache expired, remove it
                this.pddlCache.delete(cacheKey);
            }
        }
        return null;
    }

    // A* pathfinding algorithm
    findPathAStar(startX, startY, targetX, targetY) {
        const start = { x: startX, y: startY };
        const target = { x: targetX, y: targetY };

        if (!this.beliefs.isWalkable(target.x, target.y)) {
            console.warn(`Target tile ${target.x},${target.y} is not walkable.`);
            const nearestValid = this.findNearestValidTile(target.x, target.y);
            if (nearestValid) {
                console.warn(`Retrying pathfinding to nearest valid tile ${nearestValid.x},${nearestValid.y}`);
                target.x = nearestValid.x;
                target.y = nearestValid.y;
            } else {
                console.error(`Could not find a path to target ${target.x},${target.y} as it's not walkable and no nearby valid tile found.`);
                return [];
            }
        }
        if (!this.beliefs.isWalkable(start.x, start.y)) {
            console.error(`Start tile ${start.x},${start.y} is not walkable.`);
            return [];
        }

        // Node structure for A*
        class Node {
            constructor(x, y, g, h, parent = null) {
                this.x = x;
                this.y = y;
                this.g = g; // Cost from start
                this.h = h; // Heuristic cost to target
                this.f = g + h; // Total cost
                this.parent = parent;
            }

            equals(other) {
                return this.x === other.x && this.y === other.y;
            }

            getKey() {
                return `${this.x},${this.y}`;
            }
        }

        const openSet = new Set(); // Use a Set for quick lookups
        const openSetNodes = new Map(); // Map key -> Node for quick node access
        const closedSet = new Set(); // Use a Set for quick lookups

        const startNode = new Node(startX, startY, 0, this.heuristic(startX, startY, target.x, target.y));
        openSet.add(startNode.getKey());
        openSetNodes.set(startNode.getKey(), startNode);

        const directions = DIRECTIONS;

        while (openSet.size > 0) {
            // Find the node with the lowest f-score in the open set
            let currentNode = null;
            let minF = Infinity;
            for (const key of openSet) {
                const node = openSetNodes.get(key);
                if (node.f < minF) {
                    minF = node.f;
                    currentNode = node;
                }
            }

            if (!currentNode) return; // No valid node found, exit
            // Remove current node from open set and add to closed set
            openSet.delete(currentNode.getKey());
            closedSet.add(currentNode.getKey());

            // If we reached the target
            if (currentNode.equals(target)) {
                return this.reconstructPath(currentNode);
            }

            // Explore neighbors
            for (const dir of directions) {
                const neighborX = currentNode.x + dir.dx;
                const neighborY = currentNode.y + dir.dy;
                const neighborKey = `${neighborX},${neighborY}`;

                // Check boundaries and walkability
                if (neighborX < 0 || neighborX >= this.beliefs.mapWidth ||
                    neighborY < 0 || neighborY >= this.beliefs.mapHeight ||
                    !this.beliefs.isWalkable(neighborX, neighborY)) {
                    continue;
                }

                // If neighbor is in the closed set, skip
                if (closedSet.has(neighborKey)) {
                    continue;
                }

                const tentativeG = currentNode.g + 1; // Cost to move to a neighbor is 1

                // If neighbor is not in the open set or the new path is better
                if (!openSet.has(neighborKey) || tentativeG < openSetNodes.get(neighborKey).g) {
                    const neighborNode = new Node(
                        neighborX, neighborY,
                        tentativeG,
                        this.heuristic(neighborX, neighborY, target.x, target.y),
                        currentNode // Set parent
                    );

                    if (!openSet.has(neighborKey)) {
                        openSet.add(neighborKey);
                        openSetNodes.set(neighborKey, neighborNode);
                    } else {
                        // Update the node in the map if the path is better
                        openSetNodes.set(neighborKey, neighborNode);
                    }
                }
            }
        }

        // If the loop finishes and the target was not reached
        console.warn(`A* failed to find a path from ${startX},${startY} to ${target.x},${target.y}`);
        return []; // No path found
    }

    // Breadth-First Search to find the nearest valid tile
    findNearestValidTile(startX, startY) {
        const start = { x: startX, y: startY };

        if (this.beliefs.isWalkable(start.x, start.y)) {
            return start; // Already on a valid tile
        }

        const queue = [start];
        const visited = new Set();
        visited.add(`${start.x},${start.y}`);

        const directions = DIRECTIONS;

        while (queue.length > 0) {
            const current = queue.shift();

            for (const dir of directions) {
                const nextX = current.x + dir.dx;
                const nextY = current.y + dir.dy;
                const key = `${nextX},${nextY}`;

                // Check boundaries
                if (nextX < 0 || nextX >= this.beliefs.mapWidth ||
                    nextY < 0 || nextY >= this.beliefs.mapHeight) {
                    continue;
                }

                if (!visited.has(key)) {
                    visited.add(key);

                    if (this.beliefs.isWalkable(nextX, nextY)) {
                        return { x: nextX, y: nextY }; // Found nearest valid tile
                    }

                    queue.push({ x: nextX, y: nextY });
                }
            }
        }

        return null; // No valid tile found
    }


    // Reconstruct path from target node
    reconstructPath(targetNode) {
        const path = [];
        let currentNode = targetNode;
        while (currentNode !== null) {
            path.push({ x: currentNode.x, y: currentNode.y });
            currentNode = currentNode.parent;
        }
        // Reverse the path to get it from start to target (excluding the start node itself, as we are already there)
        return path.reverse().slice(1);
    }

    // Helper to get the action (move direction) from current position to next position in path
    getActionToNextStep(currentX, currentY, nextX, nextY) {
        const dx = nextX - currentX;
        const dy = nextY - currentY;

        if (dx === 1) return ACTIONS.MOVE_RIGHT;
        if (dx === -1) return ACTIONS.MOVE_LEFT;
        if (dy === 1) return ACTIONS.MOVE_UP;
        if (dy === -1) return ACTIONS.MOVE_DOWN;

        return null; // Should not happen if path is valid
    }
}