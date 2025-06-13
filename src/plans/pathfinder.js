import { DIRECTIONS, USE_PDDL_PLANNER, PDDL_TIMEOUT } from "../utils/utils.js";
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

    // Main pathfinding method con timeout PDDL
    // Main pathfinding method con timeout più corto e cache migliorata
    findPath(startX, startY, targetX, targetY) {
        if (USE_PDDL_PLANNER && this.pddlPathfinder) {
            const cacheKey = `${startX},${startY}->${targetX},${targetY}`;

            // 1. Controlla prima la cache
            const cachedResult = this.getCachedResult(cacheKey);
            if (cachedResult !== null) {
                console.log("Using cached PDDL result");
                return cachedResult;
            }

            // 2. Se c'è già una richiesta PDDL pending per questo path, usa A*
            if (this.pddlPendingRequests.has(cacheKey)) {
                console.log("PDDL request already pending, using A*");
                return this.findPathAStar(startX, startY, targetX, targetY);
            }

            // 3. Prova PDDL con timeout ridotto
            const pddlPath = this.tryPddlWithShortTimeout(startX, startY, targetX, targetY, cacheKey);
            if (pddlPath !== null) {
                console.log(`PDDL succeeded with ${pddlPath.length} steps`);
                return pddlPath;
            }

            console.log("PDDL timeout, using A* and starting background PDDL");
            // 4. Avvia PDDL in background per la prossima volta
            this.startBackgroundPddl(startX, startY, targetX, targetY, cacheKey);
        }

        // Fallback ad A*
        return this.findPathAStar(startX, startY, targetX, targetY);
    }

    // Prova PDDL con timeout molto corto (500ms)
    tryPddlWithShortTimeout(startX, startY, targetX, targetY, cacheKey) {
        try {
            console.log(`Trying PDDL with ${this.pddlTimeout}ms timeout`);

            const startTime = Date.now();
            let result = [];
            let completed = false;
            let error = null;

            // Avvia PDDL
            const pddlPromise = this.pddlPathfinder.findPath(startX, startY, targetX, targetY);

            pddlPromise.then(res => {
                result = res;
                completed = true;
                // Salva in cache
                this.pddlCache.set(cacheKey, {
                    path: res || [],
                    timestamp: Date.now()
                });
            }).catch(err => {
                error = err;
                completed = true;
                // Salva fallimento in cache
                this.pddlCache.set(cacheKey, {
                    path: [],
                    timestamp: Date.now(),
                    failed: true
                });
            });

            // Busy wait per timeout ridotto
            while (!completed && (Date.now() - startTime) < this.pddlTimeout) {
                this.busyWait(50); // Check ogni 50ms
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

    // Avvia PDDL in background senza aspettare
    startBackgroundPddl(startX, startY, targetX, targetY, cacheKey) {
        if (this.pddlPendingRequests.has(cacheKey)) {
            return; // Già in corso
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

    // Busy wait sincrono
    busyWait(ms) {
        const start = Date.now();
        while (Date.now() - start < ms) {
            // Busy wait
        }
    }

    // Controlla cache con validità estesa
    getCachedResult(cacheKey) {
        if (this.pddlCache.has(cacheKey)) {
            const cached = this.pddlCache.get(cacheKey);
            const isValid = cached.timestamp > Date.now() - 60000; // Cache valida per 60 secondi

            if (isValid) {
                if (cached.failed) {
                    // Era fallito di recente, riprova dopo un po'
                    const timeSinceFailure = Date.now() - cached.timestamp;
                    if (timeSinceFailure < 10000) { // 10 secondi di cooldown
                        return null;
                    }
                    // Rimuovi cache fallita dopo 10 secondi
                    this.pddlCache.delete(cacheKey);
                    return null;
                }
                return cached.path;
            } else {
                // Cache scaduta
                this.pddlCache.delete(cacheKey);
            }
        }
        return null;
    }

    // A* pathfinding algorithm (identico a prima)
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
                this.g = g;
                this.h = h;
                this.f = g + h;
                this.parent = parent;
            }

            equals(other) {
                return this.x === other.x && this.y === other.y;
            }

            getKey() {
                return `${this.x},${this.y}`;
            }
        }

        const openSet = new Set();
        const openSetNodes = new Map();
        const closedSet = new Set();

        const startNode = new Node(startX, startY, 0, this.heuristic(startX, startY, target.x, target.y));
        openSet.add(startNode.getKey());
        openSetNodes.set(startNode.getKey(), startNode);

        const directions = DIRECTIONS;

        while (openSet.size > 0) {
            let currentNode = null;
            let minF = Infinity;
            for (const key of openSet) {
                const node = openSetNodes.get(key);
                if (node.f < minF) {
                    minF = node.f;
                    currentNode = node;
                }
            }

            if (!currentNode) {
                console.warn(`A* no valid node found from ${startX},${startY} to ${target.x},${target.y}`);
                return [];
            }

            openSet.delete(currentNode.getKey());
            closedSet.add(currentNode.getKey());

            if (currentNode.equals(target)) {
                const path = this.reconstructPath(currentNode);
                return path || [];
            }

            for (const dir of directions) {
                const neighborX = currentNode.x + dir.dx;
                const neighborY = currentNode.y + dir.dy;
                const neighborKey = `${neighborX},${neighborY}`;

                if (neighborX < 0 || neighborX >= this.beliefs.mapWidth ||
                    neighborY < 0 || neighborY >= this.beliefs.mapHeight ||
                    !this.beliefs.isWalkable(neighborX, neighborY)) {
                    continue;
                }

                if (closedSet.has(neighborKey)) {
                    continue;
                }

                const tentativeG = currentNode.g + 1;

                if (!openSet.has(neighborKey) || tentativeG < openSetNodes.get(neighborKey).g) {
                    const neighborNode = new Node(
                        neighborX, neighborY,
                        tentativeG,
                        this.heuristic(neighborX, neighborY, target.x, target.y),
                        currentNode
                    );

                    if (!openSet.has(neighborKey)) {
                        openSet.add(neighborKey);
                        openSetNodes.set(neighborKey, neighborNode);
                    } else {
                        openSetNodes.set(neighborKey, neighborNode);
                    }
                }
            }
        }

        console.warn(`A* failed to find a path from ${startX},${startY} to ${target.x},${target.y}`);
        return [];
    }

    // Resto dei metodi rimane identico
    findNearestValidTile(startX, startY) {
        const start = { x: startX, y: startY };

        if (this.beliefs.isWalkable(start.x, start.y)) {
            return start;
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

                if (nextX < 0 || nextX >= this.beliefs.mapWidth ||
                    nextY < 0 || nextY >= this.beliefs.mapHeight) {
                    continue;
                }

                if (!visited.has(key)) {
                    visited.add(key);

                    if (this.beliefs.isWalkable(nextX, nextY)) {
                        return { x: nextX, y: nextY };
                    }

                    queue.push({ x: nextX, y: nextY });
                }
            }
        }

        return null;
    }

    reconstructPath(targetNode) {
        const path = [];
        let currentNode = targetNode;
        while (currentNode !== null) {
            path.push({ x: currentNode.x, y: currentNode.y });
            currentNode = currentNode.parent;
        }
        return path.reverse().slice(1);
    }

    getActionToNextStep(currentX, currentY, nextX, nextY) {
        const dx = nextX - currentX;
        const dy = nextY - currentY;

        if (dx === 1) return 'move_right';
        if (dx === -1) return 'move_left';
        if (dy === 1) return 'move_up';
        if (dy === -1) return 'move_down';

        return null;
    }
}